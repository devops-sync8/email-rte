using System.Net.Mail;

namespace EmailRte.Sample.Host.Endpoints;

/// <summary>Test email recipients, as typed: addresses separated by commas or semicolons.</summary>
internal static class Recipients
{
    public const int Max = 5;

    public static readonly string Error = $"Provide 1 to {Max} valid email addresses.";

    /// <summary>The addresses, or null unless there are 1 to <see cref="Max"/> valid ones.</summary>
    public static List<string>? Parse(string? to)
    {
        var list = (to ?? string.Empty).Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        return list.Count is 0 or > Max || !list.All(IsValidEmail) ? null : list;
    }

    private static bool IsValidEmail(string value) => MailAddress.TryCreate(value, out var a) && a.Address == value;
}
