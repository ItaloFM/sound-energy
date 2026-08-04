# Sound Energy

Interface web de música inspirada no Spotify. O projeto consome a Web API do Spotify para exibir playlists, pesquisar artistas, álbuns e faixas, e usa o **Web Playback SDK** para controlar a reprodução no navegador.

## Funcionalidades

- Autenticação local simples para acesso à interface;
- Login OAuth 2.0 com PKCE pelo Spotify;
- Reprodução, pausa, avanço e controle de volume pelo navegador;
- Exibição de playlists, perfil, artistas seguidos e histórico local de reprodução;
- Busca de artistas, álbuns e faixas;
- Interface responsiva, com modo instalável (PWA) e cache básico via Service Worker.

## Tecnologias

- HTML, CSS e JavaScript
- [jQuery](https://jquery.com/)
- [Bootstrap](https://getbootstrap.com/)
- [SweetAlert2](https://sweetalert2.github.io/)
- [Spotify Web API](https://developer.spotify.com/documentation/web-api)
- [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)

## Como executar

O projeto não possui etapa de compilação nem dependências locais. Ainda assim, ele deve ser servido por HTTP/HTTPS — não abra os arquivos diretamente pelo navegador, pois o OAuth e o Service Worker dependem de uma origem web.

Com o Node.js instalado, na raiz do projeto execute:

```bash
npx serve .
```

Depois, acesse o endereço informado pelo comando, normalmente `http://localhost:3000`. Também é possível usar a extensão Live Server do VS Code ou publicar os arquivos em uma hospedagem estática, como GitHub Pages.

## Configuração do Spotify

1. Crie um app no [Spotify for Developers](https://developer.spotify.com/dashboard).
2. Em **Redirect URIs**, adicione a URL de callback usada pela aplicação. Na publicação atual, ela é:

   ```text
   https://italofm.github.io/sound-energy/callback/callback.html
   ```

3. Em [`script.js`](./script.js), atualize `CLIENT_ID` e `REDIRECT_URI` para os dados do seu app.
4. Para desenvolvimento local, use uma URI como `http://localhost:3000/callback/callback.html` e registre exatamente essa mesma URI no painel do Spotify. Ajuste também o caminho `/sound-energy/` presente no `manifest.json`, no `service-worker.js` e no callback quando necessário.
5. Faça login no Sound Energy e utilize o botão de conexão com o Spotify para autorizar a conta.

> A reprodução com o Web Playback SDK exige uma conta Spotify Premium. A disponibilidade também pode variar conforme a região e as políticas do Spotify.

## Segurança

Não é seguro manter um `CLIENT_SECRET` no código enviado ao navegador. Caso o projeto seja publicado, revogue/rotacione a credencial atual no painel do Spotify e mova a troca de tokens que exige segredo para um backend. O fluxo PKCE do usuário pode continuar no cliente sem expor esse segredo.

## Estrutura

```text
.
├── index.html              # Tela principal e player
├── script.js               # Integração com a API/SDK do Spotify
├── style.css               # Estilos da tela principal
├── login/                  # Tela de login local
├── callback/               # Retorno da autorização OAuth
├── search/                 # Busca de artistas, álbuns e faixas
├── PROFILLE/               # Página de perfil
├── imgs/                   # Imagens e capas locais
├── manifest.json           # Manifesto PWA
└── service-worker.js        # Cache offline básico
```

## Licença

Este projeto não possui licença definida. Adicione uma licença antes de reutilizá-lo ou distribuí-lo publicamente.
