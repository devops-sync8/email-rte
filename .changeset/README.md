# Changesets

Run `npx changeset` to describe a change and the version bump it needs.
`npm run version-packages` applies pending changesets: it bumps the npm
packages, writes their CHANGELOGs, and syncs the NuGet version from
`packages/dotnet/package.json` into `Sync8.EmailRte.csproj`. Publishing is manual.
