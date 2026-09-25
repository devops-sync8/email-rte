---
"@sync8/email-rte": patch
"@sync8/email-rte-react": patch
"@sync8/email-rte-angular": patch
"@sync8/email-rte-dotnet": patch
---

Security fixes from a review:

- Text in the HTML output now escapes `"` and `'`, so text can never pose as an attribute to code that post-processes the HTML (merge fields, image extraction).
- A link may start with a merge field only when a path, query, fragment or nothing follows it: `{{x}}javascript:…` is no longer a link, in the renderer, the editor's button dialog and pasted HTML.
- .NET `EmailTokens.ReplaceInHtml` now reads the HTML the way a browser does, in one pass: fields in text are encoded, attribute values with fields are re-quoted and encoded, and address attributes (`href`, `src`, …) are emptied when a field gives them a scheme other than http(s), mailto, tel or cid. Field values are no longer scanned again for other fields.
- The renderer clamps `blockSpacing`, `maxImageWidth` and `lineHeight` overrides, merges extra section columns in linear time, and drops sections nested more than once.
