# Upgrading dependencies

Our policy is exact versions everywhere. Do **not** write ranges like these:

```jsonc
{
  "dependencies": {
    "semver": "*",        // resolves to whatever was published last
    "undici": "latest",   // same problem, different spelling
    "left-pad": "^0.1.0"  // caret on a pre-1.0 package is not a pin
  }
}
```

Write this instead:

```json
{
  "dependencies": {
    "semver": "7.6.3",
    "undici": "6.19.7"
  }
}
```

## Weekly bump

`npm run check:latest` prints what moved. Pick the versions you want, edit the manifest by
hand, and let CI prove the build still passes. `latest-version` is a real package we depend
on for the comparison, not a range.
