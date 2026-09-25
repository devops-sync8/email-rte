using System.Net;
using System.Text;
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
/// In address attributes (<c>href</c>, <c>src</c>, <c>background</c>, …) a field that
/// starts the address is used as is (<c>{{unsubscribeUrl}}</c>, <c>{{site}}/account</c>)
/// and the result must be an http(s), mailto, tel or cid address; fields later in the
/// address are URL-encoded. An address that gets any other scheme from a field
/// (<c>java{{x}}script:</c>) is emptied.
/// <para>
/// The HTML is read the way a browser reads it (tags, quoted and unquoted attributes,
/// comments), in one pass: text that merely looks like an attribute is text, and values
/// are never scanned again for fields.
/// </para>
/// </summary>
public static partial class EmailTokens
{
    private const string TokenSource = @"\{\{\s*([A-Za-z_][\w.-]*)\s*(?:\|([^{}]*))?\}\}";

    [GeneratedRegex(TokenSource, RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 5000)]
    private static partial Regex Token();

    [GeneratedRegex("^" + TokenSource, RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 5000)]
    private static partial Regex LeadingToken();

    [GeneratedRegex(@"^([A-Za-z][A-Za-z0-9+.\-]*):", RegexOptions.CultureInvariant)]
    private static partial Regex Scheme();

    [GeneratedRegex(@"[\t\n\r]")]
    private static partial Regex UrlWhitespace();

    /// <summary>Schemes an address may get from a merge field.</summary>
    private static readonly HashSet<string> SafeSchemes = new(StringComparer.OrdinalIgnoreCase) { "http", "https", "mailto", "tel", "cid" };

    /// <summary>Attributes whose value is an address.</summary>
    private static readonly HashSet<string> UrlAttributes = new(StringComparer.OrdinalIgnoreCase)
    {
        "href", "src", "background", "action", "formaction", "xlink:href", "poster", "cite", "srcset", "data",
    };

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

    /// <summary>
    /// One pass over the HTML: text and comments get HTML-encoded values; attribute values
    /// with fields are merged, re-quoted and encoded, with address rules for address attributes.
    /// </summary>
    private static string MergeHtml(string html, Resolver resolver)
    {
        var sb = new StringBuilder(html.Length);
        var i = 0;
        while (i < html.Length)
        {
            var lt = html.IndexOf('<', i);
            var textEnd = lt < 0 ? html.Length : lt;
            if (textEnd > i) sb.Append(MergeHtmlText(html[i..textEnd], resolver));
            if (lt < 0) break;
            if (string.CompareOrdinal(html, lt, "<!--", 0, 4) == 0)
            {
                var close = html.IndexOf("-->", lt + 4, StringComparison.Ordinal);
                var end = close < 0 ? html.Length : close + 3;
                sb.Append(MergeHtmlText(html[lt..end], resolver));
                i = end;
            }
            else if (lt + 1 < html.Length && char.IsAsciiLetter(html[lt + 1]))
            {
                i = MergeTag(html, lt, sb, resolver);
            }
            else
            {
                sb.Append('<');
                i = lt + 1;
            }
        }
        return sb.ToString();
    }

    private static string MergeHtmlText(string text, Resolver resolver)
        => Token().Replace(text, m => resolver.Resolve(m, html: true) is { } v ? WebUtility.HtmlEncode(v) : m.Value);

    /// <summary>
    /// Copies the tag starting at <paramref name="start"/> (a '&lt;' followed by a letter) to
    /// <paramref name="sb"/>, merging fields in attribute values. Follows the HTML tokenizer:
    /// quotes only delimit a value right after '='. Returns the index after the tag.
    /// </summary>
    private static int MergeTag(string html, int start, StringBuilder sb, Resolver resolver)
    {
        var n = html.Length;
        var i = start + 1;
        while (i < n && !IsTagSpace(html[i]) && html[i] is not '/' and not '>') i++; // tag name
        var copied = start;
        while (i < n)
        {
            var c = html[i];
            if (c == '>') { i++; break; }
            if (IsTagSpace(c) || c == '/') { i++; continue; }

            // Attribute name.
            var nameStart = i;
            i++; // a first '=' belongs to the name
            while (i < n && !IsTagSpace(html[i]) && html[i] is not '/' and not '>' and not '=') i++;
            var name = html[nameStart..i];
            var j = i;
            while (j < n && IsTagSpace(html[j])) j++;
            if (j >= n || html[j] != '=') { i = j; continue; } // no value
            j++;
            while (j < n && IsTagSpace(html[j])) j++;
            if (j >= n || html[j] == '>') { i = j; continue; } // empty unquoted value

            // Value.
            int valueStart = j, rawStart, rawEnd;
            if (html[j] is '"' or '\'')
            {
                var close = html.IndexOf(html[j], j + 1);
                rawStart = j + 1;
                rawEnd = close < 0 ? n : close;
                i = close < 0 ? n : close + 1;
            }
            else
            {
                rawStart = j;
                while (j < n && !IsTagSpace(html[j]) && html[j] != '>') j++;
                rawEnd = j;
                i = j;
            }

            var raw = html[rawStart..rawEnd];
            if (!raw.Contains("{{", StringComparison.Ordinal)) continue;
            var decoded = WebUtility.HtmlDecode(raw);
            var merged = UrlAttributes.Contains(name)
                ? MergeAddress(decoded, resolver)
                : Token().Replace(decoded, m => resolver.Resolve(m, html: false) ?? m.Value);
            sb.Append(html, copied, valueStart - copied).Append('"').Append(WebUtility.HtmlEncode(merged)).Append('"');
            copied = i;
        }
        sb.Append(html, copied, i - copied);
        return i;
    }

    /// <summary>Removes leading and trailing C0 control characters and spaces, as browsers do with addresses.</summary>
    private static string TrimControls(string s)
    {
        int start = 0, end = s.Length;
        while (start < end && s[start] <= ' ') start++;
        while (end > start && s[end - 1] <= ' ') end--;
        return s[start..end];
    }

    private static bool IsTagSpace(char c) => c is ' ' or '\t' or '\n' or '\r' or '\f';

    private static string MergeText(string text, Resolver resolver) => Token().Replace(text, m => resolver.Resolve(m, html: false) ?? m.Value);

    private static Func<string, string?> Lookup(IReadOnlyDictionary<string, string?> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return key => values.TryGetValue(key, out var v) ? v : null;
    }

    /// <summary>
    /// Merges an address: a leading field is the base and is used as is (it must give an
    /// http(s), mailto, tel or cid address); later fields are URL-encoded. When any field
    /// was replaced, an address that ends up with another scheme is emptied.
    /// </summary>
    private static string MergeAddress(string address, Resolver resolver)
    {
        var rest = address.Trim();
        var result = string.Empty;
        var lead = LeadingToken().Match(rest);
        var leadingReplaced = false;
        var replaced = false;
        if (lead.Success)
        {
            var v = resolver.Resolve(lead, html: false);
            result = v?.Trim() ?? lead.Value;
            leadingReplaced = replaced = v is not null;
            rest = rest[lead.Length..];
        }
        result += Token().Replace(rest, m =>
        {
            if (resolver.Resolve(m, html: false) is not { } v) return m.Value;
            replaced = true;
            return Uri.EscapeDataString(v);
        });
        if (!replaced) return result;
        // Browsers ignore tabs and line breaks in addresses, and leading/trailing control characters and spaces.
        var scheme = Scheme().Match(TrimControls(UrlWhitespace().Replace(result, string.Empty)));
        if (scheme.Success ? !SafeSchemes.Contains(scheme.Groups[1].Value) : leadingReplaced) return string.Empty;
        return result;
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
