using System.Net;
using System.Text.RegularExpressions;

namespace Sync8.EmailRte;

/// <summary>What to do with a merge field that has no value and no fallback.</summary>
public enum MissingTokenBehavior
{
    /// <summary>Remove it.</summary>
    Empty,
    /// <summary>Leave the <c>{{key}}</c> text (useful for previews).</summary>
    Keep,
    /// <summary>Throw a <see cref="MissingTokenException"/> listing every missing key.</summary>
    Error,
}

/// <summary>Merge fields had no value (see <see cref="MissingTokenBehavior.Error"/>).</summary>
public sealed class MissingTokenException(IReadOnlyList<string> keys)
    : Exception($"No value for {string.Join(", ", keys.Select(k => "{{" + k + "}}"))}")
{
    /// <summary>The keys without a value, in order of appearance.</summary>
    public IReadOnlyList<string> Keys { get; } = keys;
}

/// <summary>
/// Replaces merge fields — <c>{{key}}</c>, or <c>{{key|fallback}}</c> with a fallback for
/// empty values — in email templates, such as HTML saved from the rich text editor
/// (<c>getHtml()</c>) or any other HTML. Values are plain text and are HTML-encoded.
/// In link addresses (<c>href</c>) a field that starts the address is used as is
/// (<c>{{unsubscribeUrl}}</c>, <c>{{site}}/account</c>) and the result must be an
/// http(s), mailto or tel address, otherwise the address is emptied; fields later in
/// the address are URL-encoded.
/// </summary>
public static partial class EmailTokens
{
    private const string TokenSource = @"\{\{\s*([A-Za-z_][\w.-]*)\s*(?:\|([^{}]*))?\}\}";

    [GeneratedRegex(TokenSource, RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 5000)]
    private static partial Regex Token();

    [GeneratedRegex("^" + TokenSource, RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 5000)]
    private static partial Regex LeadingToken();

    [GeneratedRegex("""(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)')""", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase, matchTimeoutMilliseconds: 5000)]
    private static partial Regex HrefAttribute();

    [GeneratedRegex(@"^(https?://|mailto:|tel:)", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex SafeLink();

    [GeneratedRegex(@"\s*[\r\n]+\s*")]
    private static partial Regex LineBreaks();

    /// <summary>Merge field keys used in <paramref name="template"/>, in order, once each.</summary>
    public static IReadOnlyList<string> Find(string template)
    {
        ArgumentNullException.ThrowIfNull(template);
        return Token().Matches(template).Select(m => m.Groups[1].Value).Distinct(StringComparer.Ordinal).ToList();
    }

    /// <summary>Replace merge fields in an HTML template.</summary>
    public static string ReplaceInHtml(string html, IReadOnlyDictionary<string, string?> values, MissingTokenBehavior missing = MissingTokenBehavior.Empty)
        => ReplaceInHtml(html, Lookup(values), missing);

    /// <summary>Replace merge fields in an HTML template, looking values up with <paramref name="values"/>.</summary>
    public static string ReplaceInHtml(string html, Func<string, string?> values, MissingTokenBehavior missing = MissingTokenBehavior.Empty)
    {
        ArgumentNullException.ThrowIfNull(html);
        ArgumentNullException.ThrowIfNull(values);
        var resolver = new Resolver(values, missing);
        var result = MergeHtml(html, resolver);
        resolver.ThrowIfMissing();
        return result;
    }

    /// <summary>Replace merge fields in plain text (a subject line, the text/plain part).</summary>
    public static string ReplaceInText(string text, IReadOnlyDictionary<string, string?> values, MissingTokenBehavior missing = MissingTokenBehavior.Empty)
        => ReplaceInText(text, Lookup(values), missing);

    /// <summary>Replace merge fields in plain text, looking values up with <paramref name="values"/>.</summary>
    public static string ReplaceInText(string text, Func<string, string?> values, MissingTokenBehavior missing = MissingTokenBehavior.Empty)
    {
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(values);
        var resolver = new Resolver(values, missing);
        var result = MergeText(text, resolver);
        resolver.ThrowIfMissing();
        return result;
    }

    /// <summary>A copy of <paramref name="message"/> with merge fields replaced in the subject, HTML and text.</summary>
    public static EmailMessage Apply(EmailMessage message, IReadOnlyDictionary<string, string?> values, MissingTokenBehavior missing = MissingTokenBehavior.Empty)
    {
        ArgumentNullException.ThrowIfNull(message);
        // One resolver for all three parts: every missing key is reported at once, whichever part it is in.
        var resolver = new Resolver(Lookup(values), missing);
        var merged = message with
        {
            Subject = LineBreaks().Replace(MergeText(message.Subject, resolver), " "),
            Html = MergeHtml(message.Html, resolver),
            Text = message.Text is null ? null : MergeText(message.Text, resolver),
        };
        resolver.ThrowIfMissing();
        return merged;
    }

    private static string MergeHtml(string html, Resolver resolver)
    {
        // Link addresses first: they need URL rules, not just HTML encoding.
        var result = HrefAttribute().Replace(html, m =>
        {
            var raw = m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value;
            if (!raw.Contains("{{", StringComparison.Ordinal)) return m.Value;
            var href = MergeLink(WebUtility.HtmlDecode(raw), resolver);
            return $"{m.Groups[1].Value}\"{WebUtility.HtmlEncode(href)}\"";
        });
        return Token().Replace(result, m => resolver.Resolve(m, html: true) is { } v ? WebUtility.HtmlEncode(v) : m.Value);
    }

    private static string MergeText(string text, Resolver resolver) => Token().Replace(text, m => resolver.Resolve(m, html: false) ?? m.Value);

    private static Func<string, string?> Lookup(IReadOnlyDictionary<string, string?> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return key => values.TryGetValue(key, out var v) ? v : null;
    }

    private static string MergeLink(string href, Resolver resolver)
    {
        var rest = href.Trim();
        var result = string.Empty;
        var lead = LeadingToken().Match(rest);
        var leadingReplaced = false;
        if (lead.Success)
        {
            var v = resolver.Resolve(lead, html: true);
            result = v?.Trim() ?? lead.Value;
            leadingReplaced = v is not null;
            rest = rest[lead.Length..];
        }
        result += Token().Replace(rest, m => resolver.Resolve(m, html: true) is { } v ? Uri.EscapeDataString(v) : m.Value);
        // A value that is the start of the address decides where it goes: only safe schemes.
        return leadingReplaced && !SafeLink().IsMatch(result) ? string.Empty : result;
    }

    private sealed class Resolver(Func<string, string?> values, MissingTokenBehavior missing)
    {
        private readonly List<string> missingKeys = [];

        /// <summary>The value to insert, or null to keep the token. In HTML the fallback is decoded first.</summary>
        public string? Resolve(Match m, bool html)
        {
            var key = m.Groups[1].Value;
            var raw = values(key);
            var value = string.IsNullOrEmpty(raw) ? m.Groups[2].Value.Trim() : raw;
            if (html && string.IsNullOrEmpty(raw)) value = WebUtility.HtmlDecode(value);
            if (!string.IsNullOrEmpty(value)) return LineBreaks().Replace(value, " ");
            if (raw is not null) return string.Empty; // explicitly empty
            if (!missingKeys.Contains(key)) missingKeys.Add(key);
            return missing == MissingTokenBehavior.Keep ? null : string.Empty;
        }

        public void ThrowIfMissing()
        {
            if (missing == MissingTokenBehavior.Error && missingKeys.Count > 0) throw new MissingTokenException(missingKeys);
        }
    }
}
