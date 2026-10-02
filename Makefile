PORT ?= 8000

.PHONY: dev
dev:
	npm run build:pages
	node scripts/serve.mjs $(PORT)
