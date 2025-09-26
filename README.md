# 🧘 Wellbeing GNOME Shell Extension

Take regular breaks to maintain your wellbeing.

## Demo

![Demo](demo.gif)

## Features

- **Configurable Break Intervals** - Set custom time between breaks (10 seconds to 2 hours)
- **Adjustable Break Duration** - Control how long breaks last (5 seconds to 15 minutes)
- **Snooze Functionality** - Delay breaks when you need a few more minutes (5 seconds to 30 minutes)
- **Keyboard Shortcuts** - Quick actions with Space (snooze) and Escape (skip) keys
- **Status Area Integration** - Toggle extension on/off directly from the top panel
- **Smooth Animations** - Polished fade-in/fade-out transitions for break overlays

## Install from Source

```bash
git clone https://github.com/varunbpatil/wellbeing.git
cd wellbeing
./install.sh
```

## Enabling the Extension

1. Restart GNOME Shell:
   - **Wayland**: Log out and log back in 
   - **X11**: Press `Alt+F2`, type `r`, and press Enter
2. Enable the extension:
   - Using GNOME Extensions app, or
   - Command line: `gnome-extensions enable wellbeing@varunbpatil`

## Requirements

- GNOME Shell 49+
- `glib-compile-schemas` (usually included with GNOME)
