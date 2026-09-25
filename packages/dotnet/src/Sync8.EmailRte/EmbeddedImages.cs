using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Sync8.EmailRte;

/// <summary>A picture sent inside the email and shown by the HTML as <c>src="cid:ContentId"</c>.</summary>
/// <param name="ContentId">Content-ID without angle brackets, e.g. <c>img-1a2b3c4d@email-rte</c>.</param>
/// <param name="ContentType"><c>image/png</c>, <c>image/jpeg</c> or <c>image/gif</c>.</param>
/// <param name="Content">The image bytes.</param>
/// <param name="FileName">Optional file name shown if a client lists the attachment.</param>
public sealed record InlineImage(string ContentId, string ContentType, byte[] Content, string? FileName = null);

/// <summary>
/// Turns images embedded in HTML as <c>data:</c> URIs (as produced by the rich text
/// editor when no upload service is configured) into inline attachments.
/// Gmail and Outlook do not show <c>data:</c> images in received mail, but they do
/// show attachments referenced by <c>cid:</c>.
/// </summary>
public static partial class EmbeddedImages
{
    /// <summary>Largest embedded image accepted, in bytes (default 10 MB).</summary>
    public const int MaxImageBytes = 10 * 1024 * 1024;

    [GeneratedRegex("""(\ssrc=")data:image/(png|jpeg|gif);base64,([A-Za-z0-9+/]+={0,2})(")""", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 5000)]
    private static partial Regex DataImage();

    /// <summary>
    /// Replace every PNG, JPEG or GIF <c>data:</c> image in <paramref name="html"/> with a
    /// <c>cid:</c> reference. The same picture used twice is attached once. Images that are
    /// not valid base64 or exceed <see cref="MaxImageBytes"/> are left untouched.
    /// </summary>
    public static (string Html, IReadOnlyList<InlineImage> Images) Extract(string html)
    {
        ArgumentNullException.ThrowIfNull(html);
        var images = new Dictionary<string, InlineImage>(StringComparer.Ordinal);
        var result = DataImage().Replace(html, m =>
        {
            var base64 = m.Groups[3].Value;
            if (!images.TryGetValue(base64, out var image))
            {
                if (base64.Length > MaxImageBytes / 3 * 4 + 4) return m.Value;
                // Validate and decode in one pass.
                var bytes = new byte[base64.Length / 4 * 3];
                if (!Convert.TryFromBase64String(base64, bytes, out var length)) return m.Value;
                var type = m.Groups[2].Value;
                var id = $"img-{Convert.ToHexStringLower(SHA256.HashData(Encoding.ASCII.GetBytes(base64)).AsSpan(0, 8))}@email-rte";
                image = new InlineImage(id, $"image/{type}", bytes[..length], $"image-{images.Count + 1}.{(type == "jpeg" ? "jpg" : type)}");
                images.Add(base64, image);
            }
            return $"{m.Groups[1].Value}cid:{image.ContentId}{m.Groups[4].Value}";
        });
        return (result, images.Values.ToList());
    }
}
