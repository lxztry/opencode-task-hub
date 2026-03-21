# Contributing to OpenCode Task Hub

Thank you for your interest in contributing!

## Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/opencode-task-hub.git
   cd opencode-task-hub
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Running Locally

```bash
# Start the server with auto-reload
npm run dev

# Or start normally
npm start
```

### Testing Changes

1. Install the plugin from your local development directory:
   ```bash
   # macOS/Linux
   cp plugins/task-reporter.js ~/.config/opencode/plugins/
   
   # Windows
   copy plugins\task-reporter.js %USERPROFILE%\.config\opencode\plugins\
   ```

2. Open http://localhost:3030 in your browser

3. Start using OpenCode to see your changes in action

## Code Style

- Use ES modules (import/export)
- Follow existing code patterns
- Add comments for complex logic
- Keep functions small and focused

## Commit Messages

Please follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: bug fix
docs: documentation changes
style: formatting changes
refactor: code refactoring
test: adding tests
chore: maintenance tasks
```

Examples:
- `feat: add task priority levels`
- `fix: resolve WebSocket reconnect issue`
- `docs: update API documentation`

## Pull Request Process

1. Update documentation if needed
2. Test your changes thoroughly
3. Submit a PR with a clear description
4. Wait for review

## Reporting Issues

Please include:
- Node.js version
- Operating system
- Steps to reproduce
- Expected vs actual behavior

## Questions?

Feel free to open an issue for any questions!
