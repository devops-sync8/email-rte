import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLicense, copyrightFrom, guessSpdx } from './licenses.mjs';

test('rejects copyleft licenses', () => {
  for (const l of ['GPL-3.0', 'GPL-2.0-or-later', 'LGPL-2.1-only', 'AGPL-3.0', 'SSPL-1.0', 'MIT AND GPL-2.0']) {
    assert.equal(evaluateLicense('x', l).ok, false, l);
  }
});

test('rejects unknown and unlisted licenses', () => {
  for (const l of ['UNKNOWN', 'UNLICENSED', 'Custom: https://example.com', '', undefined, 'WTFPL']) {
    assert.equal(evaluateLicense('x', l).ok, false, String(l));
  }
});

test('accepts permissive licenses and permissive OR alternatives', () => {
  for (const l of ['MIT', 'BSD-3-Clause', 'Apache-2.0', 'ISC', '(MIT OR Apache-2.0)', '(MIT OR GPL-2.0)', 'MIT*']) {
    assert.equal(evaluateLicense('x', l).ok, true, l);
  }
});

test('denies CKEditor regardless of license', () => {
  assert.equal(evaluateLicense('ckeditor', 'MIT').ok, false);
  assert.equal(evaluateLicense('@ckeditor/ckeditor5-core', 'MIT').ok, false);
});

test('extracts copyright lines and recognises license texts', () => {
  const mit = 'MIT License\n\nCopyright (c) 2020 Jane Doe\n\nPermission is hereby granted, free of charge, to any person';
  assert.equal(copyrightFrom(mit, 'fallback'), 'Copyright (c) 2020 Jane Doe');
  assert.equal(copyrightFrom('no notice here', 'fallback'), 'fallback');
  const apache = 'copyright license to reproduce, prepare Derivative Works of,\n(c) You must retain, in the Source form';
  assert.equal(copyrightFrom(apache, 'fallback'), 'fallback', 'Apache boilerplate is not a copyright holder');
  assert.equal(guessSpdx(mit), 'MIT');
  assert.equal(guessSpdx('Redistribution and use in source and binary forms ... Neither the name of'), 'BSD-3-Clause');
});
