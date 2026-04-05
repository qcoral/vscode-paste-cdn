import * as vscode from "vscode";

const UPLOAD_URL = "https://cdn.hackclub.com/api/v4/upload";

const IMAGE_MIMES = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
    "image/tiff",
];

const PASTE_MIME_TYPES = [...IMAGE_MIMES, "files"];

const PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Empty.append(
    "pasteCdn",
    "upload",
);

function getApiKey(): string | undefined {
    return (
        vscode.workspace.getConfiguration("pasteCdn").get<string>("apiKey") ||
        undefined
    );
}

async function uploadImage(
    buffer: Uint8Array,
    filename: string,
    mimeType: string,
    apiKey: string,
): Promise<string> {
    const nodeBuf = Buffer.from(buffer);
    const blob = new Blob([nodeBuf], { type: mimeType });
    const form = new FormData();
    form.append("file", blob, filename);

    const res = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { url: string };
    return data.url;
}

function getImageFile(
    dataTransfer: vscode.DataTransfer,
): { file: vscode.DataTransferFile; mime: string } | undefined {
    // Try specific image mime types first
    for (const mime of IMAGE_MIMES) {
        const item = dataTransfer.get(mime);
        if (item) {
            const file = item.asFile();
            if (file) return { file, mime };
        }
    }

    // Fall back to iterating all items looking for image files
    for (const [mime, item] of dataTransfer) {
        if (mime.startsWith("image/")) {
            const file = item.asFile();
            if (file) return { file, mime };
        }
        // Handle generic "files" entries — check by extension
        const file = item.asFile();
        if (file) {
            const name = file.name.toLowerCase();
            if (/\.(png|jpe?g|gif|webp|svg|bmp|tiff?)$/.test(name)) {
                const ext = name.split(".").pop()!;
                const extToMime: Record<string, string> = {
                    png: "image/png",
                    jpg: "image/jpeg",
                    jpeg: "image/jpeg",
                    gif: "image/gif",
                    webp: "image/webp",
                    svg: "image/svg+xml",
                    bmp: "image/bmp",
                    tif: "image/tiff",
                    tiff: "image/tiff",
                };
                return { file, mime: extToMime[ext] ?? "image/png" };
            }
        }
    }

    return undefined;
}

class PasteCdnProvider implements vscode.DocumentPasteEditProvider {
    async provideDocumentPasteEdits(
        _document: vscode.TextDocument,
        _ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        _context: vscode.DocumentPasteEditContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.DocumentPasteEdit[] | undefined> {
        const apiKey = getApiKey();
        if (!apiKey) {
            vscode.window.showWarningMessage(
                "Paste CDN: No API key configured. Set pasteCdn.apiKey in settings.",
            );
            return undefined;
        }

        const imageFile = getImageFile(dataTransfer);
        if (!imageFile) return undefined;

        const { file, mime } = imageFile;
        const data = await file.data();
        if (!data || token.isCancellationRequested) return undefined;

        const ext = mime.split("/")[1] ?? "png";
        const isGenericName = !file.name || /^image\.\w+$/.test(file.name);
        const filename = isGenericName
            ? `paste-${Date.now()}.${ext}`
            : file.name;

        try {
            const url = await uploadImage(data, filename, mime, apiKey);
            if (token.isCancellationRequested) return undefined;

            const snippet = new vscode.SnippetString(`![\${1:image}](${url})`);
            const edit = new vscode.DocumentPasteEdit(
                snippet,
                "Upload to Hack Club CDN",
                PASTE_KIND,
            );
            edit.yieldTo = [];
            return [edit];
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Paste CDN: ${msg}`);
            return undefined;
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    const selector: vscode.DocumentSelector = [
        { language: "markdown" },
        { language: "mdx" },
    ];

    const provider = vscode.languages.registerDocumentPasteEditProvider(
        selector,
        new PasteCdnProvider(),
        {
            providedPasteEditKinds: [PASTE_KIND],
            pasteMimeTypes: PASTE_MIME_TYPES,
        },
    );

    context.subscriptions.push(provider);
}

export function deactivate() {}
