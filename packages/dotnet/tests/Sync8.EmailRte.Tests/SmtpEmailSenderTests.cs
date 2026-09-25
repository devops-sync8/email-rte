namespace Sync8.EmailRte.Tests;

public class SmtpEmailSenderTests
{
    [Fact]
    public void BuildMessage_SetsHtmlBodyAndHeaders()
    {
        var sender = new SmtpEmailSender(new SmtpOptions { FromAddress = "from@example.com", FromName = "Sender" });

        using var mime = sender.BuildMessage(new EmailMessage(["a@example.com", "b@example.com"], "Subject", "<p>Hi</p>"));

        Assert.Equal("Subject", mime.Subject);
        Assert.Equal(2, mime.To.Count);
        Assert.Equal("<p>Hi</p>", mime.HtmlBody);
        Assert.Equal("\"Sender\" <from@example.com>", mime.From.ToString());
    }

    [Fact]
    public void BuildMessage_RequiresRecipient()
    {
        var sender = new SmtpEmailSender(new SmtpOptions());
        Assert.Throws<ArgumentException>(() => sender.BuildMessage(new EmailMessage([], "s", "h")));
    }
}

public class InlineImageTests
{
    private const string Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    [Fact]
    public void Extract_ReplacesDataImagesWithCidReferences_AndAttachesEachPictureOnce()
    {
        var html = $"<p><img src=\"data:image/png;base64,{Png}\" alt=\"a\"><img src=\"data:image/png;base64,{Png}\"><img src=\"https://x.test/a.png\"></p>";

        var (result, images) = EmbeddedImages.Extract(html);

        var image = Assert.Single(images);
        Assert.Equal("image/png", image.ContentType);
        Assert.Equal("image-1.png", image.FileName);
        Assert.Equal(Convert.FromBase64String(Png), image.Content);
        Assert.Equal(2, result.Split($"src=\"cid:{image.ContentId}\"").Length - 1);
        Assert.Contains("src=\"https://x.test/a.png\"", result);
        Assert.DoesNotContain("data:", result);
    }

    [Theory]
    [InlineData("<img src=\"data:image/svg+xml;base64,PHN2Zz4=\">")]
    [InlineData("<img src=\"data:image/png;base64,A\">")]
    [InlineData("<p>data:image/png;base64,AAAA</p>")]
    public void Extract_LeavesOtherContentAlone(string html)
    {
        var (result, images) = EmbeddedImages.Extract(html);
        Assert.Equal(html, result);
        Assert.Empty(images);
    }

    [Fact]
    public void BuildMessage_SendsEditorAttachmentsAndDataImagesAsInlineParts()
    {
        var sender = new SmtpEmailSender(new SmtpOptions());
        var logo = new InlineImage("img-logo@email-rte", "image/png", Convert.FromBase64String(Png), "logo.png");
        var html = $"<p><img src=\"cid:img-logo@email-rte\"><img src=\"data:image/png;base64,{Png}\"></p>";

        using var mime = sender.BuildMessage(new EmailMessage(["a@example.com"], "s", html, "text", [logo]));

        // multipart/alternative: text, then multipart/related: HTML + pictures
        var related = Assert.Single(Assert.IsType<MimeKit.MultipartAlternative>(mime.Body).OfType<MimeKit.MultipartRelated>());
        var parts = related.OfType<MimeKit.MimePart>().Where(p => p.ContentType.MediaType == "image").ToList();
        Assert.Equal(2, parts.Count);
        Assert.Contains(parts, p => p.ContentId == "img-logo@email-rte" && p.FileName == "logo.png");
        Assert.All(parts, p => Assert.True(p.ContentDisposition is null || p.ContentDisposition.Disposition == MimeKit.ContentDisposition.Inline));
        Assert.DoesNotContain("data:", mime.HtmlBody);
        Assert.Contains($"cid:{parts.Single(p => p.ContentId != "img-logo@email-rte").ContentId}", mime.HtmlBody);
        Assert.Equal("text", mime.TextBody);
    }
}
