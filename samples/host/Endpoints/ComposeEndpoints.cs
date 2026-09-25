using System.Text.RegularExpressions;
using Sync8.EmailRte;

namespace EmailRte.Sample.Host.Endpoints;

/// <summary>A picture sent inside the email, as returned by the rich text editor's <c>getEmail().attachments</c>.</summary>
public sealed record ComposeAttachment(string? Cid, string? ContentType, string? Filename, string? Base64);

/// <summary>
/// The rich text editor's finished email (<c>editor.getEmail({ document, tokens })</c>):
/// HTML with <c>cid:</c> pictures, the plain-text part and the pictures.
/// </summary>
public sealed record ComposeSendRequest(string? To, string? Subject, string? Html, string? Text, IReadOnlyList<ComposeAttachment>? Attachments);

public sealed record ComposeSendResponse(string Message);

/// <summary>Sends email written in the rich text editor (the compose demo this host serves).</summary>
public static partial class ComposeEndpoints
{
    private const int MaxSubjectLength = 300;
    private const int MaxHtmlLength = 2_000_000;
    private const int MaxAttachments = 20;
    private static readonly HashSet<string> PictureTypes = ["image/png", "image/jpeg", "image/gif"];

    [GeneratedRegex(@"^[A-Za-z0-9._-]{1,120}@[A-Za-z0-9.-]{1,120}$", RegexOptions.CultureInvariant)]
    private static partial Regex ContentId();

    public static void MapComposeEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/compose");

        // Lets the compose page know it can send (the static preview cannot).
        group.MapGet("/status", (SmtpOptions smtp) => Results.Ok(new { canSend = true, from = smtp.FromAddress }));

        group.MapPost("/send", async (ComposeSendRequest request, IEmailSender sender, ILogger<ComposeSendRequest> logger, CancellationToken ct) =>
        {
            var errors = new Dictionary<string, string[]>();
            var recipients = Recipients.Parse(request.To);
            if (recipients is null) errors["to"] = [Recipients.Error];
            var subject = (request.Subject ?? string.Empty).Trim();
            if (subject.Length is 0 or > MaxSubjectLength || subject.Any(char.IsControl))
                errors["subject"] = [$"Provide a subject of at most {MaxSubjectLength} characters."];
            if (string.IsNullOrWhiteSpace(request.Html) || request.Html.Length > MaxHtmlLength)
                errors["html"] = ["The message is empty or too large."];

            var pictures = new List<InlineImage>();
            foreach (var a in request.Attachments ?? [])
            {
                if (pictures.Count >= MaxAttachments || a.Cid is null || !ContentId().IsMatch(a.Cid) || a.ContentType is null || !PictureTypes.Contains(a.ContentType))
                {
                    errors["attachments"] = ["Pictures must be PNG, JPEG or GIF with a valid content id."];
                    break;
                }
                byte[] bytes;
                try { bytes = Convert.FromBase64String(a.Base64 ?? string.Empty); }
                catch (FormatException) { errors["attachments"] = ["A picture is not valid base64."]; break; }
                if (bytes.Length is 0 or > EmbeddedImages.MaxImageBytes) { errors["attachments"] = ["A picture is empty or too large."]; break; }
                var name = Path.GetFileName(a.Filename ?? string.Empty);
                pictures.Add(new InlineImage(a.Cid, a.ContentType, bytes, string.IsNullOrWhiteSpace(name) ? null : name));
            }
            if (errors.Count > 0 || recipients is null) return Results.ValidationProblem(errors);

            try
            {
                await sender.SendAsync(new EmailMessage(recipients, subject, request.Html!, request.Text, pictures), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Sending the composed email failed");
                // The details (SMTP host, server replies) are logged, not returned to the caller.
                return Results.Problem(title: "Sending failed", detail: "The mail server did not accept the message. See the server log for details.", statusCode: StatusCodes.Status502BadGateway);
            }
            return Results.Ok(new ComposeSendResponse($"Sent to {string.Join(", ", recipients)}."));
        });
    }
}
