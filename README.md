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

O `metadata.json` declara `shell-version: ["46"]` de propósito. O código não
usa nada específico de 46 e provavelmente roda em 45–48, mas nenhuma dessas
versões foi testada; declarar compatibilidade sem verificar só transfere o
problema para o usuário. Para experimentar em outra versão, acrescente-a ao
`shell-version` e reinstale.

## O que a extensão faz

- Implementa `org.kde.StatusNotifierWatcher` e consome `StatusNotifierItem`.
- Ícones via `IconName`, `IconThemePath` e `IconPixmap` (ARGB32), cobrindo
  apps GTK, Qt/KStatusNotifierItem, Electron/Chromium, Flatpak e
  Ayatana/AppIndicator. Quando nada disso resolve, entra um ícone genérico
  consistente — nunca o quadradinho de "imagem faltando".
- Menus `com.canonical.dbusmenu` completos: submenus, separadores,
  checkbox/radio e ícones.
- Clique primário (`Activate`), secundário (menu / `ContextMenu`), do meio
  (`SecondaryActivate`) e rolagem (`Scroll`).
- Dica com o nome do aplicativo ao passar o mouse.
- Reordenação por arrastar direto no painel, com o ícone visível o tempo
  todo e os vizinhos deslizando para o novo lugar.
- Arrastar para `▲` oculta; arrastar de volta do popup restaura. Segurar o
  item sobre o `▲` por meio segundo abre o popup no meio do arraste.
- Reorganização também pelo teclado (`Ctrl`+setas).
- Indicadores `Passive` — registrados, mas sem nada a dizer — vão sozinhos
  para o overflow e voltam quando ficam ativos.
- `NeedsAttention` dá um pulso curto e depois fica só colorido; nada pisca
  sem parar.
- Ordem, itens ocultos e itens fixados persistem em GSettings entre sessões.
- Indicadores novos aparecem sozinhos; apps fechados somem sem perder a
  posição salva (voltam para onde estavam).
- Aparência herdada do tema do Shell em uso, claro ou escuro.

### Integração com o tema

Os botões da bandeja carregam também a classe `panel-button` do próprio
Shell. Hover, `active` e foco saem exatamente iguais aos dos outros botões
do painel — no Adwaita claro, no escuro e em temas de terceiros como os do
Zorin, que redefinem `#panel .panel-button` com a mesma técnica de
preenchimento (`box-shadow: inset 0 0 0 100px`). O `stylesheet.css` da
extensão mexe só em padding, raio e borda.

O popup de overflow não vive dentro de `#panel` e por isso não alcança
essas regras; para ele, e só para ele, o JS aplica `liontray-light` ou
`liontray-dark` conforme `Main.getStyleVariant()`.

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

Se algum outro processo estiver com o nome, o LionTray detecta, registra no
log quem é o dono (com PID e nome do processo) e, depois de alguns segundos,
mostra uma notificação *"Outro AppIndicator está ativo"* — em vez de
simplesmente exibir uma bandeja vazia sem explicação.

A notificação passa uma vez; enquanto o conflito durar fica também um ⚠ no
painel, e clicar nele mostra o motivo e um atalho para as preferências. A
seção **Sobre** das preferências informa quem está com o nome agora.

A espera de alguns segundos é proposital: na inicialização da sessão a
disputa pelo nome costuma se resolver sozinha, e avisar de imediato geraria
alarme falso.

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
| Reinstalar e recarregar CSS | `make reload` |
| Ver logs ao vivo | `make logs` |
| Compilar só o schema | `make schemas` |
| Checar sintaxe dos módulos | `make check` |
| Rodar os testes do backend | `make test` |
| Remover a instalação | `make uninstall` |
| Gerar o zip de distribuição | `make pack` |

Atenção ao ciclo de desenvolvimento: **`make reload` só recarrega o
`stylesheet.css`**. O Shell chama `_loadExtensionStylesheet()` a cada
`enable`, mas o módulo JS fica em cache — `_callExtensionInit()` só
reimporta quando o estado é `INITIALIZED`, e depois de um `disable` ele é
`INACTIVE`. Ou seja:

- mudou `.css` → `make reload` basta;
- mudou `.js` → `make install` e reinicie o Shell (`Alt+F2`, `r`, `Enter`);
- mudou só uma chave GSettings → aplica ao vivo, sem nada.

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
- **Reordenar dentro do popup**: arraste normalmente entre os ícones
  ocultos; o popup continua aberto durante o arraste.
- **Chegar ao popup no meio de um arraste**: segure o item sobre o `▲` por
  meio segundo e ele abre sozinho, para você soltar na posição exata.
- **Interagir**: clique esquerdo ativa, direito abre o menu, meio dispara a
  ação secundária, rolagem envia `Scroll`.
- **Descobrir de quem é o ícone**: passe o mouse e espere ~0,6 s.
- **Preferências**: clique com o botão direito no `▲`.

O botão `▲` fica escondido quando não há nada oculto (configurável) e
reaparece sozinho enquanto você arrasta. Com dois ou mais itens escondidos
ele mostra a contagem: `▲ 3`.

### Teclado

Chegue à bandeja com `Ctrl`+`Alt`+`Tab` (navegação entre áreas do painel) e
depois `Tab` / setas entre os ícones.

| Tecla | Ação |
| --- | --- |
| `Enter` / `Espaço` | Ativa o indicador |
| `Menu` ou `Shift`+`F10` | Abre o menu de contexto |
| `Ctrl`+`←` / `Ctrl`+`→` | Move o indicador uma casa |
| `Ctrl`+`↓` | Manda para o overflow |
| `Ctrl`+`↑` | Traz de volta para o painel |

## Preferências

```bash
gnome-extensions prefs liontray@lionflow.dev
```

Ou clique com o botão direito no `▲`.

Só o essencial:

- **Aparência**: tamanho dos ícones (12–32 px, padrão 18), área do painel
  (esquerda / centro / direita) e posição dentro dela;
- **Comportamento**: exibir ou não o `▲` quando vazio, mostrar a contagem de
  ocultos, ocultar indicadores passivos;
- **Organização**: resetar (com confirmação, porque não dá para desfazer);
- **Sobre**: versão, GNOME Shell detectado, quem está com a bandeja do
  sistema e o link do repositório.

A organização cotidiana é feita arrastando, não aqui.

O tamanho reage ao vivo, sem reiniciar o Shell — dá para calibrar direto:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@lionflow.dev/schemas set org.gnome.shell.extensions.liontray icon-size 20
```

O padrão é 18 e não 16 (o valor que o próprio GNOME usa no painel) porque
muitos apps entregam o ícone via `IconPixmap` com margem transparente
embutida: o bitmap tem 22 px mas o desenho ocupa só o miolo, então a 16 px o
glifo sai visivelmente menor que os ícones nativos do painel.

Para deixar o botão de overflow sempre visível, em vez de só durante um
arraste:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@lionflow.dev/schemas set org.gnome.shell.extensions.liontray hide-overflow-when-empty false
```

Para ver todo indicador registrado, inclusive os passivos:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@lionflow.dev/schemas set org.gnome.shell.extensions.liontray hide-passive false
```

Para mover a bandeja para o centro do painel, ao lado do relógio:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/liontray@lionflow.dev/schemas set org.gnome.shell.extensions.liontray panel-box center
```

`panel-box` aceita `left`, `center` e `right`; `panel-position` é o índice
entre os outros elementos daquela caixa. A ordem dos indicadores entre si
continua sendo assunto do arrastar.

### Ocultação automática de indicadores passivos

`Passive` é um dos três estados do protocolo StatusNotifierItem — quer dizer
"estou registrado, mas não tenho nada a dizer agora". É o caso do
`update-notifier` do Zorin, que fica no barramento o tempo todo e só
interessa quando há atualização.

Com `hide-passive` ligado (o padrão) esses indicadores vão direto para o
overflow e voltam sozinhos ao painel quando mudam para `Active` ou
`NeedsAttention`. A lista de ocultos escolhida por você não é tocada: a
regra é aplicada por cima, e some se você desligar a opção.

Arrastar um indicador passivo do overflow para o painel fixa ele lá
(`pinned` no GSettings), ignorando a regra daí em diante. Reordenar um
indicador ativo não fixa nada — só contrariar a regra explicitamente fixa.

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
    ├── theming.js               variante clara/escura do Shell → classe CSS
    ├── tooltip.js               dica com o nome do app ao passar o mouse
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
`NewIcon`, o parsing do layout DBusMenu (separadores, submenus, checkmarks,
ícones), o sinalizador de ícone quebrado e a detecção de conflito de
watcher. A metade de UI (`tray.js`,
`indicatorButton.js`) só roda dentro do GNOME Shell e é validada à mão.

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
