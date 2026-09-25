using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Sync8.EmailRte;

/// <summary>An email to send.</summary>
/// <param name="To">Recipient addresses.</param>
/// <param name="Subject">Subject line.</param>
/// <param name="Html">HTML body (e.g. the rich text editor's <c>getEmail().html</c>).</param>
/// <param name="Text">Optional plain-text alternative.</param>
/// <param name="InlineImages">
/// Pictures the HTML references as <c>cid:</c> (e.g. the rich text editor's
/// <c>getEmail().attachments</c>). Images embedded in the HTML as <c>data:</c> URIs
/// are converted to inline images automatically (see <see cref="EmbeddedImages"/>).
/// </param>
public sealed record EmailMessage(IReadOnlyList<string> To, string Subject, string Html, string? Text = null, IReadOnlyList<InlineImage>? InlineImages = null);

/// <summary>Sends email.</summary>
public interface IEmailSender
{
    /// <summary>Send <paramref name="message"/>.</summary>
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

/// <summary>How the SMTP connection is secured.</summary>
public enum SmtpSecurity
{
    /// <summary>Use STARTTLS when the server offers it.</summary>
    Auto,
    /// <summary>Plain connection (local test servers only).</summary>
    None,
    /// <summary>TLS from the first byte (usually port 465).</summary>
    SslOnConnect,
    /// <summary>Require STARTTLS (usually port 587).</summary>
    StartTls,
}

/// <summary>SMTP settings. Bind from configuration; keep the password out of source control.</summary>
public sealed class SmtpOptions
{
    /// <summary>SMTP host name.</summary>
    public string Host { get; set; } = "localhost";
    /// <summary>SMTP port.</summary>
    public int Port { get; set; } = 25;
    /// <summary>Connection security.</summary>
    public SmtpSecurity Security { get; set; } = SmtpSecurity.Auto;
    /// <summary>User name; leave empty for unauthenticated servers.</summary>
    public string? Username { get; set; }
    /// <summary>Password.</summary>
    public string? Password { get; set; }
    /// <summary>Sender address.</summary>
    public string FromAddress { get; set; } = "noreply@example.com";
    /// <summary>Sender display name.</summary>
    public string? FromName { get; set; }
}

/// <summary><see cref="IEmailSender"/> using SMTP (MailKit).</summary>
public sealed class SmtpEmailSender : IEmailSender
{
    private readonly SmtpOptions options;

    /// <summary>Create a sender with the given settings.</summary>
    public SmtpEmailSender(SmtpOptions options) => this.options = options ?? throw new ArgumentNullException(nameof(options));

    /// <inheritdoc />
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        using var mime = BuildMessage(message);
        using var client = new SmtpClient();

        await client.ConnectAsync(options.Host, options.Port, MapSecurity(options.Security), cancellationToken);
        if (!string.IsNullOrEmpty(options.Username))
        {
            await client.AuthenticateAsync(options.Username, options.Password ?? string.Empty, cancellationToken);
        }
        await client.SendAsync(mime, cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
    }

    /// <summary>Build the MIME message (exposed for testing).</summary>
    public MimeMessage BuildMessage(EmailMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        if (message.To.Count == 0) throw new ArgumentException("At least one recipient is required.", nameof(message));

        var mime = new MimeMessage();
        mime.From.Add(new MailboxAddress(options.FromName ?? string.Empty, options.FromAddress));
        foreach (var to in message.To) mime.To.Add(MailboxAddress.Parse(to));
        mime.Subject = message.Subject;
        // Received mail does not show data: images; send them as inline (cid:) attachments.
        var (html, embedded) = EmbeddedImages.Extract(message.Html);
        var body = new BodyBuilder { HtmlBody = html, TextBody = message.Text };
        var added = new HashSet<string>(StringComparer.Ordinal);
        foreach (var image in (message.InlineImages ?? []).Concat(embedded))
        {
            if (!added.Add(image.ContentId)) continue;
            var part = body.LinkedResources.Add(image.FileName ?? image.ContentId, image.Content, ContentType.Parse(image.ContentType));
            part.ContentId = image.ContentId;
        }
        mime.Body = body.ToMessageBody();
        return mime;
    }

    private static SecureSocketOptions MapSecurity(SmtpSecurity security) => security switch
    {
        SmtpSecurity.None => SecureSocketOptions.None,
        SmtpSecurity.SslOnConnect => SecureSocketOptions.SslOnConnect,
        SmtpSecurity.StartTls => SecureSocketOptions.StartTls,
        _ => SecureSocketOptions.Auto,
    };
}
