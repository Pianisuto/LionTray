# Changelog

Todas as mudanças relevantes do LionTray serão registradas aqui.

O projeto segue versionamento semântico a partir da primeira versão pública.

## [1.0.0] - 2026-08-23

Primeira versão pública.

### Adicionado

- implementação própria de `org.kde.StatusNotifierWatcher`;
- suporte a `StatusNotifierItem` / AppIndicator;
- resolução de ícones por `IconName`, `IconThemePath` e `IconPixmap`;
- menus `com.canonical.dbusmenu`;
- reordenação por drag-and-drop no painel e no overflow;
- ocultação/restauração de indicadores via overflow;
- persistência de ordem, itens ocultos e itens fixados;
- tratamento automático de indicadores `Passive`;
- feedback para `NeedsAttention`;
- tooltip por aplicativo;
- navegação e reorganização por teclado;
- detecção de conflito com outro `StatusNotifierWatcher`;
- integração visual com o tema do GNOME Shell;
- opção para dessaturar os ícones;
- preferências para tamanho, posição e comportamento da bandeja.

### Compatibilidade testada

- Zorin OS;
- GNOME Shell 46;
- Xorg;
- GJS 1.80.
