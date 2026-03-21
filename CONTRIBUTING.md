# Contributing to OpenCode Task Hub

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## Table of Contents

- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Reporting Issues](#reporting-issues)

## Quick Start

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/opencode-task-hub.git
cd opencode-task-hub

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- OpenCode AI coding assistant

### Environment

No environment variables are required for development. Default configuration:
- Server Port: 3030
- Data File: ./data.json

### Installing the Plugin

For local development, copy the plugin manually:

```bash
# macOS/Linux
cp plugins/task-reporter.js ~/.config/opencode/plugins/

# Windows
copy plugins\task-reporter.js %USERPROFILE%\.config\opencode\plugins\
```

## Project Structure

```
opencode-task-hub/
├── server.js           # Main server entry point
├── public/
│   └── index.html      # Dashboard UI
├── plugins/
│   ├── task-reporter.js       # Core plugin
│   ├── progress-tracker.js    # Progress tracking plugin
│   └── metrics-collector.js   # Usage metrics plugin
├── tests/
│   └── api.test.js     # Unit tests
├── scripts/
│   ├── postinstall.js  # Post-install script
│   └── lint.js         # Linting script
├── docs/
│   ├── logo.svg        # Project logo
│   ├── screenshot.png  # Dashboard screenshot
│   └── demo.gif        # Demo animation
├── .github/
│   └── workflows/
│       └── ci.yml      # CI/CD pipeline
└── data.json           # Data storage (generated)
```

## Code Style

### General Guidelines

- Use ES modules (import/export syntax)
- 2 spaces for indentation
- Single quotes for strings
- No trailing commas
- Use `const` and `let`, avoid `var`
- Prefer arrow functions
- Use async/await over raw promises

### Naming Conventions

- PascalCase for components/classes
- camelCase for functions/variables
- kebab-case for file names
- UPPER_SNAKE_CASE for constants

### Code Examples

**Good:**
```javascript
const registerSession = async (sessionId, projectPath) => {
  const session = await api('/api/sessions/register', 'POST', {
    sessionId,
    projectPath,
  });
  return session;
};
```

**Avoid:**
```javascript
var registerSession = (sessionId, projectPath) => {
  return api('/api/sessions/register', 'POST', {
    'sessionId': sessionId,
    'projectPath': projectPath,
  });
};
```

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| feat | New feature |
| fix | Bug fix |
| docs | Documentation changes |
| style | Formatting, white-space |
| refactor | Code refactoring |
| test | Adding tests |
| chore | Maintenance tasks |
| perf | Performance improvements |
| ci | CI/CD changes |

### Examples

```
feat(dashboard): add task priority levels
fix(websocket): resolve reconnection timeout issue
docs(api): add missing endpoint documentation
test(tasks): add integration tests for task assignment
ci: add Docker build step
```

## Pull Request Process

### Before Submitting

1. Fork the repository and create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following the code style guidelines

3. Add tests for new features

4. Ensure all tests pass:
   ```bash
   npm test
   npm run lint
   ```

5. Commit your changes with descriptive messages

### Submitting

1. Push your branch to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a Pull Request with:
   - Clear title and description
   - Reference any related issues
   - Screenshots for UI changes

3. Wait for review and address feedback

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Tests added/updated
- [ ] Documentation updated (if needed)
- [ ] No console.log statements
- [ ] No debuggers left in code

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Writing Tests

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('MyFeature', () => {
  test('should do something', () => {
    const result = myFunction();
    assert.strictEqual(result, expected);
  });
});
```

## Reporting Issues

### Bug Reports

Include:
- Node.js version (`node --version`)
- Operating system and version
- Steps to reproduce
- Expected vs actual behavior
- Code snippet (if applicable)

### Feature Requests

Include:
- Clear use case description
- Potential implementation approaches
- Alternative solutions considered

### Security Issues

**DO NOT** report security issues on GitHub. Email directly to maintainers.

## Questions?

- Open an issue for bugs/questions
- Check existing issues before creating new ones
- Be respectful and follow our [Code of Conduct]

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

[Back to top](#contributing-to-opencode-task-hub)
