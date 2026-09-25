# Sync8.EmailRte (.NET)

Server side of the [`@sync8/email-rte`](https://github.com/devops-sync8/email-rte)
rich text editor. Targets .NET 10 (LTS), with no ASP.NET Core or DI-container
dependency.

- `EmailTokens`: fill merge fields (`{{firstName}}`, `{{company|the team}}`) in
  HTML and plain text with the same rules as the editor: values are HTML-encoded,
  link addresses are validated, and missing fields are removed, kept or reported
  (`MissingTokenBehavior`). A field inside a `<style>` or `<script>` block throws
  `UnsafeMergeFieldException`.
- `EmbeddedImages`: turn `data:` pictures in HTML into `cid:` inline attachments,
  which mail clients show (they do not show `data:` images).
- `IEmailSender` / `SmtpEmailSender`: send HTML + text email over SMTP (MailKit),
  attaching inline pictures and converting any `data:` pictures left in the HTML.

```csharp
using Sync8.EmailRte;

var sender = new SmtpEmailSender(new SmtpOptions
{
    Host = "smtp.example.com", Port = 587, Security = SmtpSecurity.StartTls,
    FromAddress = "noreply@example.com",
});

// templateHtml / templateText: the editor's getHtml() / getText(), stored with the template.
var message = EmailTokens.Apply(
    new EmailMessage([recipient.Email], "Hi {{firstName|there}}", templateHtml, templateText),
    new Dictionary<string, string?> { ["firstName"] = recipient.FirstName },
    MissingTokenBehavior.Error);
await sender.SendAsync(message);
```

License: BSD-3-Clause. Source and third-party notices: https://github.com/devops-sync8/email-rte
