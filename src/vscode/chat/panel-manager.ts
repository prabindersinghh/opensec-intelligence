import * as vscode from 'vscode'
import { MessageHandler } from './message-handler'

export class ChatPanelManager implements vscode.WebviewViewProvider {
  public static readonly viewType = 'cmdr.chatPanel'
  private view: vscode.WebviewView | undefined
  private messageHandler: MessageHandler

  constructor(
    private extensionUri: vscode.Uri,
    messageHandler: MessageHandler,
  ) {
    this.messageHandler = messageHandler
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'assets'),
      ],
    }

    webviewView.webview.html = this.getHtml(webviewView.webview)

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        await this.messageHandler.handleWebviewMessage(msg, webviewView.webview)
      } catch (err) {
        console.error('[cmdr] webview message error:', err)
        webviewView.webview.postMessage({
          type: 'streamError',
          id: '',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })

    // Send initial state
    webviewView.webview.postMessage({
      type: 'effort',
      level: vscode.workspace.getConfiguration('cmdr').get<string>('effort', 'medium'),
    })
  }

  postMessage(message: unknown): void {
    this.view?.webview.postMessage(message)
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'app.js'),
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.css'),
    )
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} data:;
  ">
  <link href="${styleUri}" rel="stylesheet">
  <title>cmdr Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}
