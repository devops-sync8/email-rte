using System.Text.RegularExpressions;
using Mjml.Net;
using Mjml.Net.Helpers;
using Mjml.Net.Validators;

namespace Sync8.EmailRte.Tests;

/// <summary>
/// The fixture is produced by the @sync8/email-rte editor in a browser
/// (<c>npm run export-fixture</c>): every toolbar format plus a Word paste.
/// Hosts often place the editor's HTML inside an MJML template, so it must not
/// trip MJML's strict validation (Mjml.Net is a test-only dependency).
/// </summary>
public partial class RichTextEditorOutputTests
{
    private static readonly string Fragment =
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "rte-output.html")).Trim();

    // Mjml.Net re-serialises comments inside mj-text as "<!-- [if mso]>…<![endif] -->";
    // Outlook only recognises conditional comments written without those spaces.
    [GeneratedRegex(@"<!--\s+\[if ", RegexOptions.CultureInvariant)]
    private static partial Regex ConditionalStart();

    [GeneratedRegex(@"<!\[endif\]\s+-->", RegexOptions.CultureInvariant)]
    private static partial Regex ConditionalEnd();

    [Fact]
    public void EditorOutput_CompilesInsideMjText_UnderStrictValidation()
    {
        var mjml = $"<mjml><mj-body><mj-section><mj-column><mj-text>{Fragment}</mj-text></mj-column></mj-section></mj-body></mjml>";

        var (html, errors) = new MjmlRenderer().Render(mjml, new MjmlOptions
        {
            Beautify = false,
            Validator = StrictValidator.Instance,
            Fonts = new Dictionary<string, Font>(), // never link Google Fonts implicitly
        });
        html = ConditionalEnd().Replace(ConditionalStart().Replace(html, "<!--[if "), "<![endif]-->");

        Assert.False(errors.Any(), "Mjml.Net rejected editor output:\n" + string.Join("\n", errors.Select(e => e.Error)));
        Assert.Contains("<ul style=\"margin:0 0 12px 24px;padding:0;list-style-type:disc;\">", html);
        Assert.Contains("<span style=\"background-color:#ffff00;\">highlighted words</span>", html);
        Assert.Contains("border-left:3px solid #d0d7de", html);
        // Columns (Outlook ghost table + stacking inline-blocks) and buttons survive compilation.
        Assert.Contains("<!--[if mso]><td width=\"308\" valign=\"top\"><![endif]-->", html);
        Assert.Contains("display:inline-block;vertical-align:top;width:100%;max-width:308px;", html);
        Assert.Contains("mso-padding-alt:12px 24px", html);
    }
}
