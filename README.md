# LionTray

Extensão do GNOME Shell para substituir a bandeja de sistema
(`StatusNotifierItem` / AppIndicator) por uma interface simples, organizada e
mais próxima do comportamento do Windows: os indicadores ficam no painel,
podem ser reordenados por arrastar e os menos usados podem ir para um botão
de overflow.

```text
[Bitwarden] [Flameshot] [Dropbox] [▲]
        arrasta Dropbox para ▲
[Bitwarden] [Flameshot] [▲]        Dropbox agora vive no overflow
```

- UUID: `liontray@pianisuto.github.io`
- Repositório: `Pianisuto/LionTray`
- Testado em: Zorin OS, GNOME Shell 46, Xorg, GJS 1.80
- Licença: GPL-3.0-or-later

O `metadata.json` declara apenas GNOME Shell 46 de propósito. Outras versões
só devem ser adicionadas a `shell-version` depois de teste real.

## Recursos

- Implementa `org.kde.StatusNotifierWatcher` e consome `StatusNotifierItem`.
- Suporta `IconName`, `IconThemePath` e `IconPixmap`, incluindo apps GTK,
  Qt/KStatusNotifierItem, Electron/Chromium, Flatpak e Ayatana/AppIndicator.
- Fallback consistente para ícone quebrado, sem o quadradinho de imagem
  ausente do Shell.
- Menus `com.canonical.dbusmenu` com submenus, separadores, checkbox/radio e
  ícones.
- Clique primário, secundário, do meio e rolagem.
- Tooltip com o nome do aplicativo.
- Reordenação por drag-and-drop direto no painel e dentro do overflow.
- Arrastar para `▲` oculta; arrastar do popup para o painel restaura.
- Segurar um item sobre `▲` abre o overflow durante o arraste.
- Organização também pelo teclado (`Ctrl` + setas).
- Indicadores `Passive` podem ser enviados automaticamente ao overflow.
- `NeedsAttention` recebe um pulso curto, sem piscar continuamente.
- Ordem, itens ocultos e itens fixados persistem via GSettings.
- Aparência integrada ao tema do GNOME/Zorin.
- Opção para **dessaturar os ícones**, exibindo os aplicativos em tons de
  cinza sem alterar os arquivos originais.

## Instalação local

```bash
git clone https://github.com/Pianisuto/LionTray.git
cd LionTray
make install
```

Ou:

```bash
./scripts/install.sh
```

Isso instala a extensão em:

```text
~/.local/share/gnome-shell/extensions/liontray@pianisuto.github.io/
```

### Se você usou um UUID antigo

Versões de desenvolvimento anteriores usaram `liontray@lionflow.dev` e,
brevemente, `liontray@pianisuto.dev`. Como o UUID identifica a extensão para
o GNOME, remova instalações antigas uma vez:

```bash
gnome-extensions disable liontray@lionflow.dev 2>/dev/null || true
gnome-extensions disable liontray@pianisuto.dev 2>/dev/null || true
rm -rf ~/.local/share/gnome-shell/extensions/liontray@lionflow.dev
rm -rf ~/.local/share/gnome-shell/extensions/liontray@pianisuto.dev
```

Depois instale e habilite o UUID definitivo:

```bash
make install
gnome-extensions enable liontray@pianisuto.github.io
```

O schema GSettings continua com o mesmo caminho, então as preferências e a
organização salvas continuam compatíveis.

### Conflito com outro AppIndicator

O LionTray precisa ser dono de `org.kde.StatusNotifierWatcher`. No Zorin,
desative a extensão que normalmente assume essa função:

```bash
gnome-extensions disable zorin-appindicator@zorinos.com
```

Se outro processo continuar com o nome, o LionTray detecta o conflito,
registra o responsável no log e mostra um aviso no painel.

### Reiniciar o Shell

No Xorg, use `Alt+F2`, digite `r` e pressione Enter.

Também é possível:

```bash
busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Reiniciando...")'
```

No Wayland, faça logout/login.

## Uso

- **Reordenar:** arraste um ícone horizontalmente.
- **Ocultar:** arraste o ícone para `▲`.
- **Ver ocultos:** clique em `▲`.
- **Restaurar:** arraste um ícone do popup para o painel.
- **Reordenar ocultos:** arraste dentro do próprio popup.
- **Identificar um ícone:** mantenha o ponteiro sobre ele por ~0,6 s.
- **Preferências:** botão direito em `▲`.

Com dois ou mais itens ocultos, o botão pode mostrar a contagem (`▲ 3`).

### Teclado

| Tecla | Ação |
| --- | --- |
| `Enter` / `Espaço` | Ativa o indicador |
| `Menu` ou `Shift`+`F10` | Abre o menu de contexto |
| `Ctrl`+`←` / `Ctrl`+`→` | Move o indicador uma posição |
| `Ctrl`+`↓` | Move para o overflow |
| `Ctrl`+`↑` | Traz de volta ao painel |

## Preferências

```bash
gnome-extensions prefs liontray@pianisuto.github.io
```

A tela de preferências mantém apenas opções que não fazem sentido como gesto:

- **Aparência:** tamanho dos ícones, dessaturação, área do painel e posição;
- **Comportamento:** visibilidade do overflow, contagem e tratamento de
  indicadores passivos;
- **Organização:** reset da ordem/ocultos/fixados com confirmação;
- **Sobre:** versão, GNOME Shell detectado, proprietário atual do watcher e
  link do repositório.

A opção **Dessaturar os ícones** usa `Clutter.DesaturateEffect` diretamente no
ator do ícone. Isso funciona igualmente para PNG, SVG, `IconPixmap` e ícones
de tema e não modifica os arquivos entregues pelos aplicativos.

Também pode ser alterada pela linha de comando:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@pianisuto.github.io/schemas \
  set org.gnome.shell.extensions.liontray desaturate-icons true
```

Outros exemplos:

```bash
# tamanho
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@pianisuto.github.io/schemas \
  set org.gnome.shell.extensions.liontray icon-size 20

# mostrar indicadores Passive no painel
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@pianisuto.github.io/schemas \
  set org.gnome.shell.extensions.liontray hide-passive false

# mover a bandeja para o centro
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@pianisuto.github.io/schemas \
  set org.gnome.shell.extensions.liontray panel-box center
```

## Desenvolvimento

| Ação | Comando |
| --- | --- |
| Instalar / reinstalar | `make install` |
| Habilitar | `make enable` |
| Desabilitar | `make disable` |
| Reinstalar e reativar | `make reload` |
| Ver logs | `make logs` |
| Compilar schema | `make schemas` |
| Checar sintaxe | `make check` |
| Rodar testes | `make test` |
| Remover instalação | `make uninstall` |
| Gerar pacote | `make pack` |

Mudou `.js`: reinstale e reinicie o Shell. Mudou apenas CSS: `make reload`
normalmente basta. Chaves GSettings reagem ao vivo quando suportado.

### Logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i liontray
```

### Estado salvo

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@pianisuto.github.io/schemas \
  list-recursively org.gnome.shell.extensions.liontray
```

## Empacotamento e distribuição

Para gerar o ZIP destinado ao extensions.gnome.org:

```bash
make check
make test
make pack
```

O arquivo gerado é:

```text
liontray@pianisuto.github.io.zip
```

O `Makefile` mantém `metadata.json` na raiz do ZIP e exclui
`schemas/gschemas.compiled`, deixando no pacote apenas o XML do schema para o
GNOME compilar no ambiente correto.

O mesmo ZIP pode ser anexado a uma GitHub Release para instalação manual:

```bash
gnome-extensions install --force liontray@pianisuto.github.io.zip
gnome-extensions enable liontray@pianisuto.github.io
```

## Estrutura

```text
liontray@pianisuto.github.io/
├── extension.js
├── prefs.js
├── stylesheet.css
├── schemas/
│   └── org.gnome.shell.extensions.liontray.gschema.xml
└── lib/
    ├── util.js
    ├── watcher.js
    ├── statusNotifierItem.js
    ├── iconResolver.js
    ├── dbusMenu.js
    ├── theming.js
    ├── tooltip.js
    ├── indicatorButton.js
    └── tray.js
```

`watcher.js`, `statusNotifierItem.js` e `dbusMenu.js` cuidam do protocolo;
`tray.js` e `indicatorButton.js` cuidam da UI; `iconResolver.js` concentra a
resolução de ícones.

## Testes

```bash
make test
```

Os testes sobem um barramento D-Bus isolado, registram um
`StatusNotifierItem` falso e cobrem o backend sem interferir na sessão real.
A parte visual roda dentro do GNOME Shell e ainda exige smoke test manual.

## Licença

GPL-3.0-or-later.
