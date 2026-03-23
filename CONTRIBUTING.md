# Contributing to @hiero/keeper

Thank you for your interest in contributing! This document covers the development setup, testing, and pull request process.

## Development Setup

1. Clone the repository:

```bash
git clone https://github.com/hiero-ledger/hiero-keeper-sdk.git
cd hiero-keeper-sdk
```

2. Install dependencies:

```bash
npm install
```

3. Verify everything works:

```bash
npm run typecheck
npm run lint
npm test
```

## Running Tests

Run the full test suite:

```bash
npm test
```

Run tests with coverage:

```bash
npm run test:coverage
```

## Linting

```bash
npm run lint
```

## Building

```bash
npm run build
```

This produces CJS and ESM outputs in the `dist/` directory.

## Pull Request Process

1. Fork the repository and create a feature branch from `main`.
2. Make your changes with clear, focused commits.
3. Ensure all tests pass (`npm test`) and there are no lint errors (`npm run lint`).
4. Ensure type checking passes (`npm run typecheck`).
5. Open a pull request against `main` with a clear description of the change.

### DCO Sign-Off

All commits must include a DCO (Developer Certificate of Origin) sign-off line. Add `-s` to your commit command:

```bash
git commit -s -m "feat: add new feature"
```

This adds a `Signed-off-by: Your Name <your@email.com>` line to the commit message. CI will reject commits without a valid sign-off.

## Code Style

- TypeScript strict mode is enforced.
- ESLint with `typescript-eslint` strict config is used.
- Follow existing patterns in the codebase.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](./LICENSE).
