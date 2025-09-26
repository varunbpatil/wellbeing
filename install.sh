#!/bin/bash

# Wellbeing GNOME Shell Extension Installer/Updater

set -e

EXTENSION_UUID="wellbeing@varunbpatil"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

# Check if extension is currently enabled
EXTENSION_ENABLED=false
if command -v gnome-extensions >/dev/null 2>&1; then
    if gnome-extensions list --enabled 2>/dev/null | grep -q "$EXTENSION_UUID"; then
        EXTENSION_ENABLED=true
        echo "Extension is currently enabled. It will be temporarily disabled during update."
    fi
fi

# Check if this is an update or fresh install
if [ -d "$EXTENSION_DIR" ]; then
    echo "Updating Wellbeing GNOME Shell Extension..."

    # Disable extension if it's enabled
    if [ "$EXTENSION_ENABLED" = true ]; then
        echo "Disabling extension..."
        gnome-extensions disable "$EXTENSION_UUID" 2>/dev/null || true
        sleep 1
    fi

    # Remove old installation
    echo "Removing old version..."
    rm -rf "$EXTENSION_DIR"
else
    echo "Installing Wellbeing GNOME Shell Extension..."
fi

# Create extension directory
mkdir -p "$EXTENSION_DIR"

# Copy extension files (exclude install.sh, .git, and demo.gif)
echo "Copying extension files..."
find . -maxdepth 1 -type f -not -name "install.sh" -not -name ".git*" -not -name "demo.gif" -exec cp {} "$EXTENSION_DIR/" \;
find . -maxdepth 1 -type d -not -name "." -not -name ".git" -exec cp -r {} "$EXTENSION_DIR/" \;

# Compile gschema
if [ -f "$EXTENSION_DIR/schemas/org.gnome.shell.extensions.wellbeing.gschema.xml" ]; then
    echo "Compiling gschema..."
    glib-compile-schemas "$EXTENSION_DIR/schemas/"
fi

# Re-enable extension if it was previously enabled
if [ "$EXTENSION_ENABLED" = true ]; then
    echo "Re-enabling extension..."
    sleep 1
    gnome-extensions enable "$EXTENSION_UUID" 2>/dev/null || true
    echo "Extension updated and re-enabled successfully!"
else
    echo "Extension installed successfully!"
    echo ""
    echo "To enable the extension:"
    echo "  - Use GNOME Extensions app, or"
    echo "  - Command line: gnome-extensions enable $EXTENSION_UUID"
fi

echo ""
echo "If you experience any issues, restart GNOME Shell:"
echo "  - Wayland: Log out and log back in"
echo "  - X11: Press Alt+F2, type 'r', and press Enter"