#!/usr/bin/env bash
set -euo pipefail

VERSION=$(grep '^version' Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
BINARY="mcpr"
DIST="dist"

echo "Building $BINARY v$VERSION"

# Clean previous builds
rm -rf "$DIST"
mkdir -p "$DIST"

# Build release binary
cargo build --release

# Copy binary to dist/
cp "target/release/$BINARY" "$DIST/$BINARY"

# Create tarball
TARGET=$(rustc -vV | grep host | awk '{print $2}')
ARCHIVE="$DIST/${BINARY}-v${VERSION}-${TARGET}.tar.gz"
tar -czf "$ARCHIVE" -C "$DIST" "$BINARY"

echo ""
echo "Build complete:"
echo "  Binary:  $DIST/$BINARY"
echo "  Archive: $ARCHIVE"
echo "  Target:  $TARGET"
