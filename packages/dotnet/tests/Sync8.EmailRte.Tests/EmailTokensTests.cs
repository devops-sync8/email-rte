namespace Sync8.EmailRte.Tests;

public class EmailTokensTests
{
    private static readonly Dictionary<string, string?> Values = new()
    {
        ["firstName"] = "Ann <3 & co",
        ["company"] = "Acme",
        ["unsubscribeUrl"] = "https://example.com/u?id=1&t=2",
        ["site"] = "https://app.example.com",
        ["email"] = "ann+1@example.com",
        ["nickname"] = "",
        ["evil"] = "javascript:alert(1)",
        ["accountUrl"] = "https://app.example.com/account?u=1&t=2",
    };

    [Fact]
    public void ReplaceInHtml_EncodesValues_UsesFallbacks_AndKeepsMarkup()
    {
        var html = "<p style=\"color:#1f2328;\"><strong>Hi {{firstName}}</strong>, {{nickname|friend}} at {{ company }}{{missing}}. {{other|A &amp; B}}</p>";

        var result = EmailTokens.ReplaceInHtml(html, Values);

        Assert.Equal("<p style=\"color:#1f2328;\"><strong>Hi Ann &lt;3 &amp; co</strong>, friend at Acme. A &amp; B</p>", result);
    }

    [Fact]
    public void ReplaceInHtml_Links_LeadingFieldIsTheAddress_OthersAreUrlEncoded_UnsafeAddressesEmptied()
    {
        var html = "<a href=\"{{unsubscribeUrl}}\">U</a> <a href=\"{{site}}/account?u={{email}}&amp;x=1\">A</a> <a href=\"{{evil}}\">B</a> <a href=\"https://x.test/\">C</a>";

        var result = EmailTokens.ReplaceInHtml(html, Values);

        Assert.Equal("<a href=\"https://example.com/u?id=1&amp;t=2\">U</a> <a href=\"https://app.example.com/account?u=ann%2B1%40example.com&amp;x=1\">A</a> <a href=\"\">B</a> <a href=\"https://x.test/\">C</a>", result);
    }

    // Security review: text that looks like an attribute must not hide a real address from validation.
    [Theory]
    [InlineData("<p>Details at href=\"<a href=\"{{zz}}javascript:alert(document.domain)\">our site</a></p>")]
    [InlineData("<p>Details at href='<a href='{{zz}}javascript:alert(1)'>x</a></p>")]
    [InlineData("<a href={{zz}}javascript:alert(1)>x</a>")]
    [InlineData("<a/href=\"{{zz}}javascript:alert(1)\">x</a>")]
    [InlineData("<a title=\"x\"href=\"{{zz}}javascript:alert(1)\">x</a>")]
    [InlineData("<a href=\"java{{zz}}script:alert(1)\">x</a>")]
    [InlineData("<a href=\"{{zz}}  jav&#x09;ascript:alert(1)\">x</a>")]
    [InlineData("<a HREF = \"{{zz}}JavaScript:alert(1)\">x</a>")]
    [InlineData("<img src=\"{{zz}}javascript:alert(1)\">")]
    public void ReplaceInHtml_NeverProducesAScriptAddress(string html)
    {
        var result = EmailTokens.ReplaceInHtml(html, new Dictionary<string, string?>());

        Assert.DoesNotContain("javascript:", result.Replace("\t", "").Replace("&#x09;", ""), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ReplaceInHtml_TextThatLooksLikeAnAttributeStaysText()
    {
        var result = EmailTokens.ReplaceInHtml("<p>Use href=\"{{site}}\" here</p>", Values);

        Assert.Equal("<p>Use href=\"https://app.example.com\" here</p>", result);
    }

    [Fact]
    public void ReplaceInHtml_ValuesAreNotScannedForFieldsAgain()
    {
        var values = new Dictionary<string, string?> { ["website"] = "https://attacker.example/c?t={{resetToken}}", ["resetToken"] = "SECRET-123" };

        var result = EmailTokens.ReplaceInHtml("<a href=\"{{website}}\">site</a> <p>{{website}}</p> <img alt=\"{{website}}\">", values);

        Assert.DoesNotContain("SECRET", result);
        Assert.Contains("<a href=\"https://attacker.example/c?t={{resetToken}}\">", result);
    }

    [Fact]
    public void ReplaceInHtml_AttributeValuesAreQuotedAndEncoded()
    {
        var values = new Dictionary<string, string?> { ["name"] = "x\" onerror=\"alert(1)", ["plain"] = "a b onerror=alert(1)" };

        var result = EmailTokens.ReplaceInHtml("<img alt=\"{{name}}\" title={{plain}} src=\"cid:logo\">", values);

        Assert.Equal("<img alt=\"x&quot; onerror=&quot;alert(1)\" title=\"a b onerror=alert(1)\" src=\"cid:logo\">", result);
    }

    [Fact]
    public void ReplaceInHtml_AddressesAllowRelativeAndCid_WhenFieldsAreLater()
    {
        var result = EmailTokens.ReplaceInHtml("<a href=\"/u?e={{email}}\">u</a><img src=\"{{logo}}\">", new Dictionary<string, string?> { ["email"] = "a@b.c", ["logo"] = "cid:logo@x" });

        Assert.Equal("<a href=\"/u?e=a%40b.c\">u</a><img src=\"cid:logo@x\">", result);
    }

    [Fact]
    public void ReplaceInHtml_CommentsAndStrayAngleBracketsAreText()
    {
        var result = EmailTokens.ReplaceInHtml("<!--[if mso]><td width=\"{{w}}\"><![endif]--><p>1 < 2 {{w}}</p>", new Dictionary<string, string?> { ["w"] = "<b>" });

        Assert.Equal("<!--[if mso]><td width=\"&lt;b&gt;\"><![endif]--><p>1 < 2 &lt;b&gt;</p>", result);
    }

    [Fact]
    public void MissingBehavior_KeepAndError()
    {
        const string html = "<p>{{a}} {{b|B}} {{c}}</p>";

        Assert.Equal("<p>{{a}} B {{c}}</p>", EmailTokens.ReplaceInHtml(html, Values, MissingTokenBehavior.Keep));
        var e = Assert.Throws<MissingTokenException>(() => EmailTokens.ReplaceInHtml(html, Values, MissingTokenBehavior.Error));
        Assert.Equal(["a", "c"], e.Keys);
        Assert.Equal("<p>A B C</p>", EmailTokens.ReplaceInHtml(html, k => k.ToUpperInvariant(), MissingTokenBehavior.Error));
    }

    [Fact]
    public void ReplaceInText_DoesNotEncode_AndLineBreaksBecomeSpaces()
    {
        var result = EmailTokens.ReplaceInText("Hi {{firstName}}, {{note}}", new Dictionary<string, string?> { ["firstName"] = "A & B", ["note"] = "one\r\ntwo" });
        Assert.Equal("Hi A & B, one two", result);
    }

    [Fact]
    public void Find_ListsKeysOnce_InOrder()
    {
        Assert.Equal(["firstName", "site", "company"], EmailTokens.Find("{{firstName}} <a href=\"{{site}}/x\">{{ company|Us }}</a> {{firstName}} {{ not a token }}"));
    }

    [Fact]
    public void Apply_MergesSubjectHtmlAndText_AndReportsAllMissingKeys()
    {
        var message = new EmailMessage(["a@example.com"], "Welcome, {{firstName|there}}", "<p>Hi {{firstName}} from {{company}}</p>", "Hi {{firstName}} from {{company}}");

        var merged = EmailTokens.Apply(message, Values);

        Assert.Equal("Welcome, Ann <3 & co", merged.Subject);
        Assert.Equal("<p>Hi Ann &lt;3 &amp; co from Acme</p>", merged.Html);
        Assert.Equal("Hi Ann <3 & co from Acme", merged.Text);
        var e = Assert.Throws<MissingTokenException>(() => EmailTokens.Apply(message with { Subject = "{{x}}", Text = "{{y}}" }, Values, MissingTokenBehavior.Error));
        Assert.Equal(["x", "y"], e.Keys);
    }

    [Fact]
    public void RichTextEditorTemplate_MergesToValidEmail()
    {
        var template = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "rte-output.html"));
        var keys = EmailTokens.Find(template);
        Assert.Contains("firstName", keys);

        var merged = EmailTokens.ReplaceInHtml(template, Values, MissingTokenBehavior.Error);

        Assert.DoesNotContain("{{", merged);
        Assert.Contains("Ann &lt;3 &amp; co", merged);
        // The button in the column links to the merged address.
        Assert.Contains("<a href=\"https://app.example.com/account?u=1&amp;t=2\" target=\"_blank\" style=\"display:inline-block;", merged);
    }
}
