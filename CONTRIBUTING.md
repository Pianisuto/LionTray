# Contribuindo com o LionTray

Obrigado pelo interesse em contribuir. O LionTray é uma extensão pequena e o objetivo é manter o código simples, previsível e fácil de revisar.

## Antes de começar

- Para bugs, abra um **Bug report** e inclua distro, versão do GNOME Shell, Xorg/Wayland e passos para reproduzir.
- Para mudanças maiores de comportamento ou UX, abra uma **Feature request** antes de implementar. Isso evita trabalho em uma direção que talvez não combine com o projeto.
- Correções pequenas podem ir direto para um Pull Request.

## Ambiente de desenvolvimento

Clone o repositório e instale localmente:

```bash
git clone https://github.com/Pianisuto/LionTray.git
cd LionTray
make install
```

O UUID oficial é:

```text
liontray@pianisuto.github.io
```

Não altere o UUID em contribuições normais.

### Comandos úteis

```bash
make check
make test
make pack
```

- `make check`: compila o schema e valida a sintaxe JavaScript.
- `make test`: executa os testes do backend em um barramento D-Bus isolado.
- `make pack`: gera o ZIP de distribuição.

Mudanças de JavaScript exigem reinstalação e reinício do GNOME Shell para serem testadas corretamente. No Xorg, use `Alt+F2`, `r`, Enter. No Wayland, faça logout/login.

## Pull Requests

Um bom PR deve:

1. resolver um problema bem definido;
2. evitar refatorações não relacionadas;
3. manter compatibilidade com o comportamento documentado;
4. incluir testes quando a mudança atingir o backend testável;
5. passar em `make check` e, quando possível, `make test`;
6. explicar como a parte visual foi testada quando houver alteração de UI.

Prefira PRs pequenos e focados. É mais fácil revisar, testar e reverter.

## Estilo

- Preserve a separação entre protocolo/D-Bus e UI.
- Evite dependências externas sem necessidade real.
- Não inclua `schemas/gschemas.compiled`, ZIPs gerados ou arquivos de cache no Git.
- Strings visíveis ao usuário devem ser claras e consistentes.
- Comentários devem explicar decisões ou armadilhas, não repetir o código.

## Relatando problemas

Para bugs, inclua logs quando forem relevantes:

```bash
journalctl -b -o cat /usr/bin/gnome-shell | grep -iE 'liontray|stack trace'
```

Nunca publique tokens, senhas, chaves privadas ou outros segredos nos Issues.

## Licença

Ao contribuir, você concorda que sua contribuição será distribuída sob a licença GPL-3.0-or-later do projeto.
