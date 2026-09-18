# Build the CLI for this Mac's arch into dist/.
build:
    mkdir -p dist
    swiftc -O -target "$(uname -m)-apple-macos13.0" -import-objc-header plow-messages-bridge.h plow-messages.swift -o dist/plow-messages

# Build, then run the suite against the built binary.
test: build
    npx vitest run
