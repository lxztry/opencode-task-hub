#!/bin/bash

# OpenCode Task Hub - Cross-platform Installer
# Supports: macOS, Linux, Windows (WSL/Git Bash)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 OpenCode Task Hub Installer${NC}"
echo ""

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*)    echo "macos";;
        Linux*)     echo "linux";;
        MINGW*|MSYS*|CYGWIN*) echo "windows";;
        *)          echo "unknown";;
    esac
}

OS=$(detect_os)
echo -e "Detected OS: ${YELLOW}${OS}${NC}"
echo ""

# Detect config directory
detect_config_dir() {
    case "$OS" in
        macos|linux)    echo "$HOME/.config/opencode";;
        windows)        echo "$APPDATA/opencode" ;;
        *)              echo "$HOME/.config/opencode";;
    esac
}

CONFIG_DIR=$(detect_config_dir)
PLUGIN_DIR="$CONFIG_DIR/plugins"
OPENCODE_CONFIG="$CONFIG_DIR/opencode.json"

echo "Config directory: $CONFIG_DIR"
echo ""

# Create plugin directory
echo -e "${YELLOW}Creating plugin directory...${NC}"
mkdir -p "$PLUGIN_DIR"

# Copy plugin
echo -e "${YELLOW}Installing plugin...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/plugins/task-reporter.js" "$PLUGIN_DIR/"
echo -e "${GREEN}✓ Plugin installed${NC}"

# Update opencode.json
echo -e "${YELLOW}Configuring opencode.json...${NC}"

if [ -f "$OPENCODE_CONFIG" ]; then
    # Check if plugin already configured
    if grep -q "task-reporter" "$OPENCODE_CONFIG" 2>/dev/null; then
        echo -e "${GREEN}✓ Plugin already configured${NC}"
    else
        # Backup original
        cp "$OPENCODE_CONFIG" "$OPENCODE_CONFIG.backup"
        
        # Add plugin to array or create new config
        if grep -q '"plugins"' "$OPENCODE_CONFIG" 2>/dev/null; then
            # Add to existing plugins array (simple approach)
            sed -i.bak 's/"plugins": \[/"plugins": ["task-reporter", /' "$OPENCODE_CONFIG"
            rm "$OPENCODE_CONFIG.bak"
        elif grep -q '"plugin"' "$OPENCODE_CONFIG" 2>/dev/null; then
            # Handle single plugin format
            sed -i.bak 's/"plugin": \["/"plugin": ["task-reporter", "/' "$OPENCODE_CONFIG"
            rm "$OPENCODE_CONFIG.bak"
        else
            # Add new plugins field
            echo ', "plugin": ["task-reporter"]' >> "$OPENCODE_CONFIG"
        fi
        echo -e "${GREEN}✓ Plugin configured${NC}"
    fi
else
    # Create new config
    cat > "$OPENCODE_CONFIG" << 'EOF'
{
  "plugin": ["task-reporter"]
}
EOF
    echo -e "${GREEN}✓ Config file created${NC}"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo ""
echo -e "Next steps:"
echo -e "  1. Run: ${YELLOW}npm install${NC}"
echo -e "  2. Run: ${YELLOW}npm start${NC}"
echo -e "  3. Open: ${YELLOW}http://localhost:3030${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
