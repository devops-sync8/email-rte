---
"@sync8/email-rte-dotnet": minor
---

`EmailTokens.ReplaceInHtml` and `Apply` throw `UnsafeMergeFieldException` when a merge field is inside a `<style>` or `<script>` block, where HTML encoding cannot make a value safe. The contents of those blocks are otherwise copied unchanged. The editor and renderer never produce such blocks.
