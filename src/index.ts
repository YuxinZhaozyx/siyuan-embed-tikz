import {
  Dialog,
  Plugin,
  getFrontend,
  fetchPost,
  IWebSocketData,
} from "siyuan";
import "@/index.scss";
import PluginInfoString from '@/../plugin.json'
import { Editor } from "./editor";
import { compileTikZ, initializeTikZ } from "./tikz";
import { unescapeHTML, escapeHTML } from "./utils";

let PluginInfo = {
  version: '',
}
try {
  PluginInfo = PluginInfoString
} catch (err) {
  console.log('Plugin info parse error: ', err)
}
const {
  version,
} = PluginInfo

export default class TikZPlugin extends Plugin {
  // Run as mobile
  public isMobile: boolean
  // Run in browser
  public isBrowser: boolean
  // Run as local
  public isLocal: boolean
  // Run in Electron
  public isElectron: boolean
  // Run in window
  public isInWindow: boolean
  public platform: SyFrontendTypes
  public readonly version = version

  private _openMenuImageHandler;
  private _clickBlockIconHandler;
  private _globalKeyDownHandler;

  async onload() {
    this.initMetaInfo();
    initializeTikZ(`/plugins/${this.name}/libs/tikzjax`);

    this.protyleSlash = [{
      filter: ["tikz"],
      id: "tikz",
      html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">TikZ</span></div>`,
      callback: (protyle, nodeElement) => {
        this.newTikZImage(nodeElement.dataset.nodeId, "", (imageInfo) => {
          this.openEditDialog(imageInfo);
        });
      },
    }];

    this._openMenuImageHandler = this.openMenuImageHandler.bind(this);
    this.eventBus.on("open-menu-image", this._openMenuImageHandler);

    this._clickBlockIconHandler = this.clickBlockIconHandler.bind(this);
    this.eventBus.on("click-blockicon", this._clickBlockIconHandler);

    this._globalKeyDownHandler = this.globalKeyDownHandler.bind(this);
    document.documentElement.addEventListener("keydown", this._globalKeyDownHandler);
  }

  onunload() {
    this.eventBus.off("open-menu-image", this._openMenuImageHandler);
    this.eventBus.off("click-blockicon", this._clickBlockIconHandler);
    document.documentElement.removeEventListener("keydown", this._globalKeyDownHandler);
  }

  // openSetting() {
  // }

  private initMetaInfo() {
    const frontEnd = getFrontend();
    this.platform = frontEnd as SyFrontendTypes
    this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
    this.isBrowser = frontEnd.includes('browser');
    this.isLocal = location.href.includes('127.0.0.1') || location.href.includes('localhost');
    this.isInWindow = location.href.includes('window.html');

    try {
      require("@electron/remote")
        .require("@electron/remote/main");
      this.isElectron = true;
    } catch (err) {
      this.isElectron = false;
    }
  }

  public openEditDialog(imageInfo: TikZImageInfo, autoCompile?: boolean, autoClose?:boolean) {
    const editDialogHTML = `
<div class="tikz-edit-dialog">
    <div class="edit-dialog-header resize__move"></div>
    <div class="edit-dialog-container">
        <div class="edit-dialog-editor"></div>
        <div class="fn__hr--b"></div>
        <textarea readonly class="edit-dialog-message fn__none" placeholder="${this.i18n.noMessage}"></textarea>
    </div>
    <div class="b3-dialog__action">
        <div data-action="main">
            <button data-action="success" class="b3-button b3-button--success fn__none">${this.i18n.compileSuccessButton}</button>
            <button data-action="error" class="b3-button b3-button--error fn__none">${this.i18n.compileErrorButton}</button>
            <div class="fn__space"></div>
            <button data-action="compile" class="b3-button b3-button--text">${this.i18n.compile}</button>
        </div>
        <div data-action="compiling" class="status__backgroundtask fn__none">${this.i18n.compiling}<div><div></div></div></div>
    </div>
</div>
    `;

    const dialog = new Dialog({
      content: editDialogHTML,
      width: this.isMobile ? "92vw" : "70vw",
      height: "80vh",
      hideCloseIcon: this.isMobile,
    });

    // 创建编辑器
    const editorContainer = dialog.element.querySelector(".edit-dialog-editor") as HTMLElement;
    const editor = new Editor(editorContainer, imageInfo.tikzCode);
    editor.focus();

    const compileHandler = async () => {
      editor.setEditable(false);
      dialog.element.querySelector("[data-action=main]").classList.toggle("fn__none", true);
      dialog.element.querySelector("[data-action=compiling]").classList.toggle("fn__none", false);
      dialog.element.querySelector(".edit-dialog-message").classList.toggle("fn__none", true);

      imageInfo.tikzCode = editor.getContent();
      const compileResult = await compileTikZ(imageInfo.tikzCode);
      this.updateTikZImage(imageInfo, compileResult.svgCode, () => {
        const timestamp = Date.now();
        document.querySelectorAll(`img[data-src='${imageInfo.imageURL}']`).forEach(imageElement => {
          (imageElement as HTMLImageElement).src = imageInfo.imageURL + "?t=" + timestamp; // 重载图片，加时间戳以避免浏览器缓存图片
        });
      });
      dialog.element.querySelector("[data-action=success]").classList.toggle("fn__none", !compileResult.ok);
      dialog.element.querySelector("[data-action=error]").classList.toggle("fn__none", compileResult.ok);
      dialog.element.querySelector(".edit-dialog-message").classList.toggle("fn__none", compileResult.ok);
      (dialog.element.querySelector(".edit-dialog-message") as HTMLTextAreaElement).value = compileResult.message;
      if (autoClose && compileResult.ok) dialog.destroy(); 

      editor.setEditable(true);
      dialog.element.querySelector("[data-action=main]").classList.toggle("fn__none", false);
      dialog.element.querySelector("[data-action=compiling]").classList.toggle("fn__none", true);
    }
    dialog.element.querySelector("[data-action=compile]").addEventListener("click", compileHandler);

    const compileSuccessHandler = () => {
      dialog.destroy();
    }
    dialog.element.querySelector("[data-action=success]").addEventListener("click", compileSuccessHandler);

    const compileErrorHandler = () => {
      dialog.element.querySelector(".edit-dialog-message").classList.toggle("fn__none");
    }
    dialog.element.querySelector("[data-action=error]").addEventListener("click", compileErrorHandler);

    if (autoCompile) compileHandler();
  }

  public async getTikZImageInfo(imageURL: string): Promise<TikZImageInfo | null> {
    const imageURLRegex = /^assets\/.+\.svg$/;
    if (!imageURLRegex.test(imageURL)) return null;

    const svgContent = await this.getTikZImage(imageURL);
    if (!svgContent) return null;

    const tempElement = document.createElement("template");
    tempElement.innerHTML = svgContent;
    const scriptElement = tempElement.content.querySelector("script[type='text/x-tikz']");
    if (!scriptElement) return null;

    const imageInfo: TikZImageInfo = {
      imageURL: imageURL,
      tikzCode: unescapeHTML(scriptElement.textContent),
    }
    return imageInfo;
  }

  public getPlaceholderImageContent(tikzCode: string): string {
    let imageContent = `<svg height="256" node-id="1" sillyvg="true" template-height="1024" template-width="1024" version="1.1" viewBox="0 0 1024 1024" width="256" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="background-color: white;">
    <metadata><script type="text/x-tikz">${escapeHTML(tikzCode)}</script></metadata>
    <defs node-id="42"><linearGradient gradientUnits="objectBoundingBox" id="未命名的渐变_4" node-id="5" spreadMethod="pad" x1="-782.36" x2="-782.36" y1="1893.87" y2="1897.52"><stop offset="0" stop-color="#e7e9eb" stop-opacity="0"/><stop offset="0.32" stop-color="#e7e9eb" stop-opacity="0.1"/><stop offset="1" stop-color="#e7e9eb"/></linearGradient><linearGradient gradientUnits="objectBoundingBox" id="未命名的渐变_17" node-id="9" spreadMethod="pad" x1="-779.28" x2="-777.54" y1="1898.41" y2="1894.79"><stop offset="0" stop-color="#f2f2f2"/><stop offset="1" stop-color="#cecfd1"/></linearGradient><linearGradient gradientUnits="objectBoundingBox" id="未命名的渐变_16" node-id="12" spreadMethod="pad" x1="-777.46" x2="-777.99" y1="1898.26" y2="1894.6"><stop offset="0" stop-color="#f2f2f2"/><stop offset="1" stop-color="#d8d9db"/></linearGradient><linearGradient gradientUnits="objectBoundingBox" id="未命名的渐变_15" node-id="15" spreadMethod="pad" x1="-719.07" x2="-715.41" y1="1919.83" y2="1919.83"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.5"/></linearGradient><linearGradient gradientUnits="objectBoundingBox" id="未命名的渐变_14" node-id="18" spreadMethod="pad" x1="-777.19" x2="-777.19" y1="1872.13" y2="1868.47"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.2"/></linearGradient><linearGradient gradientUnits="objectBoundingBox" id="未命名的渐变_13" node-id="21" spreadMethod="pad" x1="-779.47" x2="-779.47" y1="1877.69" y2="1874.04"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.7"/></linearGradient></defs><g node-id="81"><path d="M 3.31 707.15 C 3.31 707.15 51.72 552.15 215.85 553.25 C 305.85 553.81 375.62 594.38 433.10 613.33 C 480.37 628.87 519.32 623.57 554.30 622.05 C 631.84 618.64 715.22 584.33 796.14 587.17 C 877.07 589.83 887.85 621.67 942.50 638.54 C 984.10 651.43 1024.00 677.39 1024.00 699.54 C 1024.00 726.15 1008.68 759.23 958.00 767.64 C 883.69 779.77 649.80 864.30 396.80 842.13 C 166.50 821.90 0.00 775.18 0.00 721.46 C 0.42 716.56 1.53 711.74 3.31 707.15 Z" fill="url(#未命名的渐变_4)" fill-rule="nonzero" group-id="1" id="路径_16806" node-id="26" stroke="none" target-height="312.14996" target-width="1024" target-x="0" target-y="552.15"/><path d="M 713.14 809.23 C 713.14 829.43 623.09 845.80 512.00 845.80 C 400.91 845.80 310.86 829.43 310.86 809.23 C 310.86 789.03 400.91 772.66 512.00 772.66 C 623.09 772.66 713.14 789.03 713.14 809.23 Z" fill="#eef0f2" fill-rule="nonzero" group-id="1" id="椭圆_770" node-id="27" stroke="none" target-height="73.140076" target-width="402.28" target-x="310.85995" target-y="772.6599"/><path d="M 146.28 483.08 C 146.28 483.08 144.57 497.08 149.28 503.50 C 150.98 505.77 160.43 510.50 161.19 521.84 C 161.76 532.99 157.19 553.60 127.72 554.75 C 100.50 555.89 65.14 546.62 75.16 505.97 C 81.59 484.79 101.63 489.15 99.55 453.22 C 99.19 428.64 111.65 403.30 120.17 404.44 C 127.92 405.38 128.49 417.44 133.97 427.32 C 137.56 434.10 147.58 442.42 146.28 483.08 Z" fill="#eef0f2" fill-rule="nonzero" group-id="1" id="路径_16807" node-id="28" stroke="none" target-height="152.59003" target-width="96.619995" target-x="65.14" target-y="403.3"/><path d="M 117.32 588.58 C 117.32 591.23 122.23 591.99 122.23 586.69 C 122.04 581.57 121.87 566.46 121.10 558.53 C 120.91 556.27 119.59 551.35 119.78 550.02 C 120.34 547.02 124.31 537.36 125.26 534.33 C 129.09 520.43 130.56 505.99 129.61 491.60 C 128.29 471.93 126.96 471.93 124.88 472.13 C 122.80 472.33 124.88 483.66 125.25 490.85 C 126.67 508.40 124.35 526.06 118.44 542.65 C 118.07 543.65 115.79 547.00 112.95 541.52 C 110.11 536.04 96.50 516.75 104.26 498.22 C 106.72 492.55 103.12 493.31 100.26 498.79 C 97.75 504.02 96.83 509.86 97.61 515.61 C 99.98 526.40 104.20 536.70 110.09 546.05 C 112.37 548.92 114.22 552.10 115.57 555.51 C 117.00 561.74 117.32 588.58 117.32 588.58 Z" fill="#d8d9db" fill-rule="nonzero" group-id="1" id="路径_16808" node-id="29" stroke="none" target-height="120.06" target-width="34.060303" target-x="96.5" target-y="471.93"/><path d="M 935.89 536.00 C 935.89 536.00 934.19 550.00 938.89 556.42 C 940.59 558.69 950.04 563.42 950.80 574.76 C 951.36 585.92 946.80 606.53 917.33 607.67 C 890.10 608.81 854.75 599.55 864.77 558.89 C 871.20 537.72 891.24 542.07 889.16 506.14 C 888.79 481.56 901.26 456.23 909.77 457.36 C 917.53 458.30 918.09 470.36 923.57 480.24 C 927.18 487.05 937.20 495.37 935.89 536.00 Z" fill="#eef0f2" fill-rule="nonzero" group-id="1" id="路径_16809" node-id="30" stroke="none" target-height="152.57999" target-width="96.609985" target-x="854.75" target-y="456.23"/><path d="M 908.83 641.52 C 908.83 644.17 913.74 644.93 913.74 639.63 C 913.55 634.51 913.37 619.40 912.61 611.47 C 912.42 609.21 911.09 604.29 911.28 602.96 C 911.85 599.96 915.82 590.29 916.77 587.27 C 920.60 573.37 922.07 558.93 921.12 544.54 C 919.79 524.87 918.47 524.87 916.39 525.06 C 914.31 525.25 916.39 536.60 916.75 543.78 C 918.18 561.34 915.86 579.00 909.95 595.59 C 909.58 596.54 907.30 599.94 904.46 594.46 C 901.62 588.98 888.00 569.69 895.77 551.16 C 898.22 545.49 894.63 546.25 891.77 551.73 C 889.27 556.96 888.35 562.81 889.13 568.55 C 891.50 579.35 895.73 589.65 901.62 599.00 C 903.91 601.86 905.76 605.05 907.11 608.45 C 908.27 614.68 908.83 641.52 908.83 641.52 Z" fill="#d8d9db" fill-rule="nonzero" group-id="1" id="路径_16810" node-id="31" stroke="none" target-height="120.06" target-width="34.069946" target-x="888" target-y="524.87"/><path d="M 159.31 274.90 C 159.31 288.37 148.39 299.29 134.92 299.29 C 121.45 299.29 110.53 288.37 110.53 274.90 C 110.53 261.43 121.45 250.51 134.92 250.51 C 148.39 250.51 159.31 261.43 159.31 274.90 Z" fill="#eef0f2" fill-rule="nonzero" group-id="1" id="椭圆_767" node-id="32" stroke="none" target-height="48.779984" target-width="48.78" target-x="110.53" target-y="250.51"/><path d="M 54.17 526.75 C 54.17 537.19 45.70 545.66 35.26 545.66 C 24.82 545.66 16.35 537.19 16.35 526.75 C 16.35 516.31 24.82 507.84 35.26 507.84 C 45.70 507.84 54.17 516.31 54.17 526.75 Z" fill="#eef0f2" fill-rule="nonzero" group-id="1" id="椭圆_768" node-id="33" stroke="none" target-height="37.820007" target-width="37.820007" target-x="16.349997" target-y="507.83997"/><path d="M 905.05 350.55 C 905.05 359.58 901.46 368.23 895.08 374.61 C 888.70 380.99 880.05 384.58 871.02 384.58 C 861.99 384.58 853.34 380.99 846.96 374.61 C 840.58 368.23 836.99 359.58 836.99 350.55 C 836.99 341.52 840.58 332.87 846.96 326.49 C 853.34 320.11 861.99 316.52 871.02 316.52 C 880.05 316.52 888.70 320.11 895.08 326.49 C 901.46 332.87 905.05 341.52 905.05 350.55 Z" fill="#eef0f2" fill-rule="nonzero" group-id="1" id="椭圆_769" node-id="34" stroke="none" target-height="68.06" target-width="68.06006" target-x="836.99" target-y="316.52"/></g><g node-id="82"><path d="M 708.34 633.13 L 312.00 563.26 C 292.11 559.76 278.83 540.79 282.33 520.90 L 282.33 520.90 L 337.08 210.45 C 340.23 192.53 351.08 180.22 372.99 180.22 C 375.15 180.15 377.32 180.34 379.44 180.78 L 775.74 250.65 C 785.30 252.32 793.80 257.73 799.37 265.67 C 804.95 273.61 807.14 283.44 805.46 293.00 L 805.46 293.00 L 750.71 603.47 C 747.63 620.94 732.45 633.69 714.71 633.70 C 712.57 633.70 710.44 633.51 708.34 633.13 Z" fill="url(#未命名的渐变_17)" fill-rule="nonzero" group-id="2" id="路径_16935" node-id="36" stroke="none" target-height="453.54883" target-width="528.31006" target-x="278.82596" target-y="180.1512"/><path d="M 285.26 289.93 L 687.55 289.93 C 697.25 289.93 706.55 293.78 713.41 300.64 C 720.27 307.50 724.12 316.80 724.12 326.50 L 724.12 641.00 C 724.12 650.70 720.27 660.00 713.41 666.86 C 706.55 673.72 697.25 677.57 687.55 677.57 L 285.26 677.57 C 275.56 677.57 266.26 673.72 259.40 666.86 C 252.54 660.00 248.69 650.70 248.69 641.00 L 248.69 326.50 C 248.69 316.80 252.54 307.50 259.40 300.64 C 266.26 293.78 275.56 289.93 285.26 289.93 Z" fill="url(#未命名的渐变_16)" fill-rule="nonzero" group-id="2" id="矩形_17743" node-id="37" stroke="none" target-height="387.64" target-width="475.42993" target-x="248.69002" target-y="289.93"/><path d="M 665.60 374.04 C 665.60 392.22 650.87 406.95 632.69 406.95 C 614.51 406.95 599.78 392.22 599.78 374.04 C 599.78 355.86 614.51 341.13 632.69 341.13 C 650.87 341.13 665.60 355.86 665.60 374.04 Z" fill="url(#未命名的渐变_15)" fill-rule="nonzero" group-id="2" id="椭圆_808" node-id="38" stroke="none" target-height="65.82001" target-width="65.81995" target-x="599.78" target-y="341.13"/><path d="M 498.90 611.74 L 634.49 611.74 C 658.49 611.59 673.31 590.60 661.41 574.36 L 594.30 484.59 C 588.68 477.14 580.04 465.46 566.87 465.46 C 553.94 465.46 547.44 476.33 541.05 484.74 L 472.56 575.13 C 460.27 591.52 474.90 611.90 498.90 611.74 Z" fill="url(#未命名的渐变_14)" fill-rule="nonzero" group-id="2" id="路径_16915" node-id="39" stroke="none" target-height="146.44003" target-width="213.04001" target-x="460.27" target-y="465.46"/><path d="M 344.82 611.74 L 510.54 611.74 C 539.87 611.52 557.99 581.74 543.46 558.62 L 461.46 431.05 C 454.00 419.55 444.00 407.00 427.89 407.00 C 412.63 407.00 403.53 420.29 396.33 431.32 L 312.63 559.76 C 297.61 583.00 315.48 612.00 344.82 611.74 Z" fill="url(#未命名的渐变_13)" fill-rule="nonzero" group-id="2" id="路径_16916" node-id="40" stroke="none" target-height="205" target-width="260.38" target-x="297.61" target-y="407"/></g>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="160" fill="#555">TikZ</text>
</svg>`;
    const tempElement = document.createElement("template");
    tempElement.innerHTML = imageContent;
    tempElement.content.firstElementChild.setAttribute("updated", new Date().toISOString());
    imageContent = tempElement.content.firstElementChild.outerHTML;
    return imageContent;
  }

  public newTikZImage(blockID: string, tikzCode: string, callback?: (imageInfo: TikZImageInfo) => void) {
    const imageName = 'tikz-image.svg';
    const placeholderImageContent = this.getPlaceholderImageContent(tikzCode);
    const blob = new Blob([placeholderImageContent], { type: 'image/svg+xml' });
    const file = new File([blob], imageName, { type: 'image/svg+xml' });
    const formData = new FormData();
    formData.append('file[]', file);
    fetchPost('/api/asset/upload', formData, (response) => {
      const imageURL = response.data.succMap[imageName];
      fetchPost('/api/block/updateBlock', {
        id: blockID,
        data: `![](${imageURL})`,
        dataType: "markdown",
      });
      const imageInfo: TikZImageInfo = {
        imageURL: imageURL,
        tikzCode: tikzCode,
      };
      if (callback) {
        callback(imageInfo);
      }
    });
  }

  public async getTikZImage(imageURL: string): Promise<string> {
    const response = await fetch(imageURL);
    if (!response.ok) return "";
    const svgContent = await response.text();
    return svgContent;
  }

  public updateTikZImage(imageInfo: TikZImageInfo, svgCode: string, callback?: (response: IWebSocketData) => void) {
    if (!svgCode) {
      svgCode = this.getPlaceholderImageContent(imageInfo.tikzCode);
    }
    const blob = new Blob([svgCode], { type: 'image/svg+xml' });
    const file = new File([blob], imageInfo.imageURL.split('/').pop(), { type: 'image/svg+xml' });
    const formData = new FormData();
    formData.append("path", 'data/' + imageInfo.imageURL);
    formData.append("file", file);
    formData.append("isDir", "false");
    fetchPost("/api/file/putFile", formData, callback);
  }

  private openMenuImageHandler({ detail }) {
    const selectedElement = detail.element;
    const imageElement = selectedElement.querySelector("img") as HTMLImageElement;
    const imageURL = imageElement.dataset.src;
    this.getTikZImageInfo(imageURL).then((imageInfo: TikZImageInfo) => {
      if (imageInfo) {
        window.siyuan.menus.menu.addItem({
          id: "edit-tikz",
          icon: 'iconEdit',
          label: `${this.i18n.editTikZ}`,
          index: 1,
          click: () => {
            this.openEditDialog(imageInfo);
          }
        })
      }
    })
  }

  private clickBlockIconHandler({ detail }) {
    if (detail.blockElements.length != 1) return;
    const selectedElement = detail.blockElements[0];
    const iframeElement = selectedElement.querySelector("iframe[src='/widgets/siyuan-tikz/']");
    if (iframeElement) {
      window.siyuan.menus.menu.addItem({
        id: "transform-tikz",
        icon: 'iconRefresh',
        label: `${this.i18n.transformTikZ}`,
        index: 0,
        click: () => {
          const tikzCode = selectedElement.getAttribute("custom-latex-code") || "";
          this.newTikZImage(selectedElement.dataset.nodeId, tikzCode, (imageInfo) => {
            this.openEditDialog(imageInfo, true, true);
          });
        }
      });
    }
  }

  private globalKeyDownHandler = (event: KeyboardEvent) => {
    // 如果是在代码编辑器里使用快捷键，则阻止冒泡 https://github.com/YuxinZhaozyx/siyuan-embed-tikz/issues/1
    console.log("hello");
    if (document.activeElement.closest(".b3-dialog--open .tikz-edit-dialog")) {
      console.log("world");
      event.stopPropagation();
    }
  };

}
