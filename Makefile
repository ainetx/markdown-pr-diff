# Markdown PR Diff — build entry points.
#
# A thin front for the npm scripts, so the common tasks are discoverable
# without reading package.json. Every target is safe to run repeatedly.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# The OAuth App's client id is public by design and is baked into the bundle.
# Export it, or pass it on the command line:
#   make build GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_ID ?=
export VITE_GITHUB_CLIENT_ID = $(GITHUB_CLIENT_ID)

NPM := npm
VERSION := $(shell node -p "require('./src/manifest.json').version")

.PHONY: help
help: ## Show this help
	@echo "Markdown PR Diff $(VERSION)"
	@echo
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  Load the built extension from dist/ via chrome://extensions."
ifeq ($(strip $(GITHUB_CLIENT_ID)),)
	@echo "  GITHUB_CLIENT_ID is unset: the device flow will be unavailable and"
	@echo "  the options page will ask for a personal access token instead."
endif

node_modules: package-lock.json package.json
	$(NPM) ci
	@touch node_modules

.PHONY: install
install: node_modules ## Install dependencies

.PHONY: build
build: node_modules ## Build the extension into dist/
	$(NPM) run build

.PHONY: dev
dev: node_modules ## Open the fixture playground with live reload
	$(NPM) run dev

.PHONY: test
test: node_modules ## Run the test suite
	$(NPM) test

.PHONY: watch
watch: node_modules ## Run the tests and re-run them on change
	$(NPM) run test:watch

.PHONY: check
check: node_modules ## Typecheck, lint, test, then build and verify dist/
	$(NPM) run check

.PHONY: verify
verify: ## Re-verify an existing dist/ without rebuilding
	$(NPM) run verify

.PHONY: format
format: node_modules ## Rewrite sources with prettier
	$(NPM) run format

.PHONY: package
package: check ## Build, verify and zip for the Chrome Web Store
	$(NPM) run package
	@echo
	@ls -lh markdown-pr-diff-$(VERSION).zip

.PHONY: version
version: ## Stamp a version into dist/ (make version V=1.0.0)
	@test -n "$(V)" || { echo "usage: make version V=1.0.0"; exit 1; }
	node scripts/set-version.mjs "$(V)"

.PHONY: icons
icons: ## Regenerate the placeholder icons
	node scripts/make-icons.mjs

.PHONY: clean
clean: ## Remove build output
	rm -rf dist .pgcheck markdown-pr-diff-*.zip

.PHONY: distclean
distclean: clean ## Also remove installed dependencies
	rm -rf node_modules
