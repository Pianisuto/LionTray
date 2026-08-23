UUID    := liontray@pianisuto.github.io
SRC     := $(UUID)
DEST    := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: help schemas install uninstall enable disable reload logs pack check test

help:
	@echo "LionTray - alvos disponiveis"
	@echo "  make install    instala em ~/.local/share/gnome-shell/extensions"
	@echo "  make uninstall  remove a instalacao local"
	@echo "  make enable     habilita a extensao"
	@echo "  make disable    desabilita a extensao"
	@echo "  make reload     reinstala e reativa (X11: reinicie o Shell com Alt+F2 r)"
	@echo "  make logs       acompanha o journal do gnome-shell"
	@echo "  make schemas    compila o schema GSettings no diretorio fonte"
	@echo "  make pack       gera o zip para o extensions.gnome.org"
	@echo "  make check      checagem de sintaxe dos modulos"
	@echo "  make test       testes do backend em barramento D-Bus isolado"

schemas:
	glib-compile-schemas --strict $(SRC)/schemas

install: schemas
	mkdir -p $(DEST)
	cp -r $(SRC)/. $(DEST)/
	@echo "instalado em $(DEST)"

uninstall:
	rm -rf $(DEST)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

reload: install
	-gnome-extensions disable $(UUID)
	gnome-extensions enable $(UUID)

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

pack: schemas
	rm -f $(UUID).zip
	cd $(SRC) && zip -r ../$(UUID).zip . \
		-x '*.zip' \
		-x 'schemas/gschemas.compiled'

check: schemas
	@tmp=$$(mktemp -d); \
	for f in $(SRC)/extension.js $(SRC)/prefs.js $(SRC)/lib/*.js; do \
		cp "$$f" "$$tmp/$$(basename $$f .js).mjs"; \
		node --check "$$tmp/$$(basename $$f .js).mjs" && echo "ok   $$f"; \
	done; \
	rm -rf "$$tmp"

test:
	./tests/run.sh
