# Contributing

Thanks for helping improve dpdm.

## Maintenance Standards

- Keep changes focused on one bug fix, feature, or maintenance concern.
- Preserve existing CLI behavior unless a breaking change is intentional and documented.
- Add or update tests for parser, resolver, circular dependency, or output behavior changes.
- Run the relevant checks before merging:

  ```bash
  npm run test -- --run
  npm run typecheck
  npm run build
  ```

- Run Prettier for touched files, or verify formatting with:

  ```bash
  npx prettier --check <files>
  ```

## Versioning

dpdm follows semantic versioning:

- Patch: bug fixes and documentation-only changes.
- Minor: backward-compatible features and CLI options.
- Major: breaking CLI, API, output, or dependency-resolution behavior.

## Releases

Use the GitHub Actions release workflow from the default branch after CI is
green. Choose the version bump type (`patch`, `minor`, or `major`) according to
the rules above. The workflow runs tests, checks types, builds the package,
bumps the version, creates a tag, publishes to npm with provenance, and creates
a GitHub release.

Close issues only after the fix has landed on the default branch. For released
fixes or features, include the released version in the closing comment.
