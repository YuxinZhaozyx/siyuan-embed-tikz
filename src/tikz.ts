import { Worker, spawn, Thread } from 'threads';
import { escapeHTML } from './utils';

export async function compileTikZ(tikzCode: string): Promise<IResCompileTikZ> {
    const result: IResCompileTikZ = {
        ok: false,
        tikzCode: tikzCode,
        svgCode: "",
        message: "",
    }

    let texWorker;
    try {
        texWorker = await initializeWorker();
        result.svgCode = await texWorker.texify(tikzCode, { embedFonts: true });
        result.ok = true;

        const tempElement = document.createElement("template");
        tempElement.innerHTML = `<metadata><script type="text/x-tikz">${escapeHTML(tikzCode)}</script></metadata>`;
        const metadataElement = tempElement.content.querySelector("metadata");
        tempElement.innerHTML = result.svgCode;
        const svgElement = tempElement.content.querySelector("svg");
        if (svgElement) {
            if (svgElement.firstChild) {
                svgElement.insertBefore(metadataElement, svgElement.firstChild);
            } else {
                svgElement.appendChild(metadataElement);
            }
            svgElement.setAttribute("updated", new Date().toISOString());
            svgElement.style="background-color: white;";
            result.svgCode = svgElement.outerHTML;
        } else {
            throw new Error("No generated image");
        }
    } catch (err) {
        result.ok = false;
        result.message = err.toString();
    } finally {
        await Thread.terminate(await texWorker);
        texWorker = null;
    }

    return result;
}

let urlRoot: string;

export const initializeTikZ = (tikzjaxUrlRoot: string) => {
    urlRoot = tikzjaxUrlRoot;
}

const initializeWorker = async () => {
    // Set up the worker thread.
    const tex = await spawn(new Worker(`${urlRoot}/run-tex.js`));
    Thread.events(tex).subscribe((e) => {
        if (e.type == 'message' && typeof e.data === 'string') console.log(e.data);
    });

    // Load the assembly and core dump.
    try {
        await tex.load(urlRoot);
    } catch (err) {
        console.log(err);
    }

    return tex;
};


