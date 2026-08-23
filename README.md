# LionTray

Extensão do GNOME Shell que substitui a bandeja de sistema
(`StatusNotifierItem` / AppIndicator) por uma interface simples e direta,
inspirada no comportamento do Windows: os ícones ficam no painel, você os
reordena arrastando e joga os que não usa em um botão de overflow.

```
[Bitwarden] [Flameshot] [Dropbox] [▲]
        arrasta Dropbox para ▲
[Bitwarden] [Flameshot] [▲]        Dropbox agora vive dentro do popup
```

- UUID: `liontray@lionflow.dev`
- Testado em: Zorin OS, GNOME Shell 46, Xorg, GJS 1.80
- Licença: GPL-3.0-or-later

## O que a V1 faz

- Implementa `org.kde.StatusNotifierWatcher` e consome `StatusNotifierItem`.
- Ícones via `IconName`, `IconThemePath` e `IconPixmap` (ARGB32), cobrindo
  apps GTK, Qt/KStatusNotifierItem, Electron/Chromium, Flatpak e
  Ayatana/AppIndicator.
- Menus `com.canonical.dbusmenu` completos: submenus, separadores,
  checkbox/radio e ícones.
- Clique primário (`Activate`), secundário (menu / `ContextMenu`), do meio
  (`SecondaryActivate`) e rolagem (`Scroll`).
- Reordenação por arrastar direto no painel.
- Arrastar para `▲` oculta; arrastar de volta do popup restaura.
- Ordem e itens ocultos persistem em GSettings entre sessões.
- Indicadores novos aparecem sozinhos; apps fechados somem sem perder a
  posição salva (voltam para onde estavam).

## Instalação local

```bash
git clone <url-do-repositorio> LionTray
```

```bash
cd LionTray && make install
```

Ou, sem `make`:

```bash
./scripts/install.sh
```

Isso compila o schema GSettings e copia tudo para
`~/.local/share/gnome-shell/extensions/liontray@lionflow.dev/`.

### Desativar o AppIndicator do Zorin

LionTray precisa ser dono do nome `org.kde.StatusNotifierWatcher`. Desative
qualquer outra extensão que faça o mesmo:

```bash
gnome-extensions disable zorin-appindicator@zorinos.com
```

### Ativar o LionTray

```bash
gnome-extensions enable liontray@lionflow.dev
```

### Reiniciar o GNOME Shell

No Xorg:

```bash
busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Reiniciando...")'
```

Ou, mais simples: `Alt+F2`, digite `r`, `Enter`.

No Wayland não há restart do Shell — faça logout e login.

## Comandos do dia a dia

| Ação | Comando |
| --- | --- |
| Instalar / reinstalar | `make install` |
| Habilitar | `make enable` |
| Desabilitar | `make disable` |
| Reinstalar e reativar | `make reload` |
| Ver logs ao vivo | `make logs` |
| Compilar só o schema | `make schemas` |
| Checar sintaxe dos módulos | `make check` |
| Rodar os testes do backend | `make test` |
| Remover a instalação | `make uninstall` |
| Gerar o zip de distribuição | `make pack` |

Equivalentes diretos, sem `make`:

```bash
gnome-extensions enable liontray@lionflow.dev
```

```bash
gnome-extensions disable liontray@lionflow.dev
```

```bash
gnome-extensions info liontray@lionflow.dev
```

```bash
gnome-extensions prefs liontray@lionflow.dev
```

### Logs

Tudo que a extensão registra sai com o prefixo `[LionTray]`.

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Apenas as mensagens da extensão:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i liontray
```

Erros desde o último boot:

```bash
journalctl -b -o cat /usr/bin/gnome-shell | grep -iE 'liontray|stack trace'
```

Para depurar `prefs.js` (roda em outro processo):

```bash
journalctl -f -o cat /usr/bin/gjs
```

### Inspecionar o estado salvo

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@lionflow.dev/schemas list-recursively org.gnome.shell.extensions.liontray
```

Resetar a organização pela linha de comando:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@lionflow.dev/schemas reset-recursively org.gnome.shell.extensions.liontray
```

### Verificar quem é dono do watcher

```bash
busctl --user get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems
```

## Uso

- **Reordenar**: arraste um ícone horizontalmente na barra.
- **Ocultar**: arraste o ícone para cima do botão `▲`.
- **Ver ocultos**: clique no `▲`.
- **Restaurar**: com o popup aberto, arraste o ícone de volta para a barra.
- **Interagir**: clique esquerdo ativa, direito abre o menu, meio dispara a
  ação secundária, rolagem envia `Scroll`.

O botão `▲` fica escondido quando não há nada oculto (configurável) e
reaparece sozinho enquanto você arrasta.

## Preferências

```bash
gnome-extensions prefs liontray@lionflow.dev
```

Só o essencial:

- tamanho dos ícones (12–32 px);
- exibir ou não o botão de overflow quando ele está vazio;
- resetar organização.

A organização cotidiana é feita arrastando, não aqui.

## Estrutura

```
liontray@lionflow.dev/
├── extension.js                 bootstrap: liga backend e UI, desfaz tudo em disable()
├── prefs.js                     preferências mínimas (Adw)
├── stylesheet.css
├── schemas/
│   └── org.gnome.shell.extensions.liontray.gschema.xml
└── lib/
    ├── util.js                  helpers D-Bus e chave estável de identidade
    ├── watcher.js               org.kde.StatusNotifierWatcher (protocolo)
    ├── statusNotifierItem.js    um indicador: propriedades, sinais, métodos
    ├── iconResolver.js          IconName / IconThemePath / IconPixmap → GIcon
    ├── dbusMenu.js              cliente com.canonical.dbusmenu → PopupMenu
    ├── indicatorButton.js       ator de um indicador (clique, scroll, drag)
    └── tray.js                  tray visível, overflow, DnD e persistência
```

A separação é intencional: `watcher.js`, `statusNotifierItem.js` e
`dbusMenu.js` não conhecem St/Clutter; `tray.js` e `indicatorButton.js` não
falam D-Bus diretamente.

## Testes

```bash
make test
```

Sobe um barramento D-Bus isolado (`dbus-run-session`), registra um
`StatusNotifierItem` falso e exercita o backend inteiro sem tocar na sua
sessão: posse do nome `org.kde.StatusNotifierWatcher`, registro e remoção de
itens, leitura de propriedades, conversão de `IconPixmap` ARGB32 para PNG,
resolução por `IconName`, `Activate`/`SecondaryActivate`/`Scroll`, o sinal
`NewIcon` e o parsing do layout DBusMenu (separadores, submenus,
checkmarks, ícones). A metade de UI (`tray.js`, `indicatorButton.js`) só roda
dentro do GNOME Shell e é validada à mão.

### Identidade persistida

A ordem é salva por uma chave estável derivada do campo `Id` do
`StatusNotifierItem` (`bitwarden`, `dropbox-client`, `chrome_status_icon_1`),
com fallback para `Title` e para o object path. O nome D-Bus efêmero
(`:1.102`) nunca entra na chave, então a organização sobrevive a reinícios do
app e da sessão.

## Notas de licença

Escrito do zero, mas a arquitetura segue o mesmo desenho de projetos GPL
conhecidos do ecossistema (Status Tray, AppIndicator/KStatusNotifierItem
Support). O projeto é distribuído sob **GPL-3.0-or-later** para permanecer
compatível caso trechos desses projetos venham a ser incorporados; nesse caso,
preserve as atribuições e os cabeçalhos de licença originais.
