using EmailRte.Sample.Host.Endpoints;
using Microsoft.Extensions.FileProviders;
using Sync8.EmailRte;

var builder = WebApplication.CreateBuilder(args);

// appsettings.example.json holds safe defaults and is the only settings file in
// source control. appsettings.json, user secrets and environment variables
// (e.g. Smtp__Password) override it.
builder.Configuration.Sources.Insert(0, new ChainedConfigurationSource
{
    Configuration = new ConfigurationBuilder()
        .SetBasePath(builder.Environment.ContentRootPath)
        .AddJsonFile("appsettings.example.json", optional: false)
        .Build(),
});

builder.Services.AddSingleton(builder.Configuration.GetSection("Smtp").Get<SmtpOptions>() ?? new SmtpOptions());
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();

var app = builder.Build();

// The rich text editor demo, which sends what it composes through this host's SMTP settings:
// `compose-app` when published, samples/rte-demo/dist during development.
var composePath = new[] { app.Configuration["EmailRte:ComposeAppPath"], "compose-app", "../rte-demo/dist" }
    .Where(p => !string.IsNullOrWhiteSpace(p))
    .Select(p => Path.GetFullPath(p!, app.Environment.ContentRootPath))
    .FirstOrDefault(Directory.Exists)
    ?? throw new InvalidOperationException("Build the demo first: npm run build (from the repository root).");
var composeFiles = new PhysicalFileProvider(composePath);
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = composeFiles });
app.UseStaticFiles(new StaticFileOptions { FileProvider = composeFiles });

app.MapComposeEndpoints();

app.Run();

public partial class Program;
