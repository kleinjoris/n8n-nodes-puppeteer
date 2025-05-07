"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Puppeteer = exports.vmResolver = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const vm2_1 = require("@n8n/vm2");
const puppeteer_extra_1 = __importDefault(require("puppeteer-extra"));
const puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
const puppeteer_extra_plugin_human_typing_1 = __importDefault(require("puppeteer-extra-plugin-human-typing"));
const axios_1 = __importDefault(require("axios"));
const puppeteer_1 = require("puppeteer");
const Puppeteer_node_options_1 = require("./Puppeteer.node.options");
const { NODE_FUNCTION_ALLOW_BUILTIN: builtIn, NODE_FUNCTION_ALLOW_EXTERNAL: external, CODE_ENABLE_STDOUT, } = process.env;
const CONTAINER_LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
];
exports.vmResolver = (0, vm2_1.makeResolverFromLegacyOptions)({
    external: external
        ? {
            modules: [...external.split(','), 'axios'],
            transitive: false,
        }
        : { modules: ['axios'], transitive: false },
    builtin: (_a = builtIn === null || builtIn === void 0 ? void 0 : builtIn.split(',')) !== null && _a !== void 0 ? _a : [],
});
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.75 Safari/537.36';
async function handleError(error, itemIndex, url, page) {
    if (page) {
        try {
            await page.close();
        }
        catch (closeError) {
            console.error('Error closing page:', closeError);
        }
    }
    if (this.continueOnFail()) {
        const nodeOperationError = new n8n_workflow_1.NodeOperationError(this.getNode(), error.message);
        const errorResponse = {
            json: {
                error: error.message,
            },
            pairedItem: {
                item: itemIndex,
            },
            error: nodeOperationError,
        };
        if (url) {
            errorResponse.json.url = url;
        }
        return [errorResponse];
    }
    throw new n8n_workflow_1.NodeOperationError(this.getNode(), error.message);
}
async function handleOptions(itemIndex, items, browser, page) {
    const options = this.getNodeParameter('options', 0, {});
    const pageCaching = options.pageCaching !== false;
    const headers = (options.headers || {});
    const requestHeaders = (headers.parameter || []).reduce((acc, header) => {
        acc[header.name] = header.value;
        return acc;
    }, {});
    const device = options.device;
    await page.setCacheEnabled(pageCaching);
    if (device) {
        const emulatedDevice = puppeteer_1.KnownDevices[device];
        if (emulatedDevice) {
            await page.emulate(emulatedDevice);
        }
    }
    else {
        const userAgent = requestHeaders['User-Agent'] ||
            requestHeaders['user-agent'] ||
            DEFAULT_USER_AGENT;
        await page.setUserAgent(userAgent);
    }
    await page.setExtraHTTPHeaders(requestHeaders);
}
async function runCustomScript(itemIndex, items, browser, page) {
    const scriptCode = this.getNodeParameter('scriptCode', itemIndex);
    const context = Object.assign(Object.assign({ $getNodeParameter: this.getNodeParameter, $getWorkflowStaticData: this.getWorkflowStaticData, helpers: Object.assign(Object.assign({}, this.helpers), { httpRequestWithAuthentication: this.helpers.httpRequestWithAuthentication.bind(this), requestWithAuthenticationPaginated: this.helpers.requestWithAuthenticationPaginated.bind(this) }) }, this.getWorkflowDataProxy(itemIndex)), { $browser: browser, $page: page, $puppeteer: puppeteer_extra_1.default, $axios: axios_1.default });
    const vm = new vm2_1.NodeVM({
        console: 'redirect',
        sandbox: context,
        require: exports.vmResolver,
        wasm: false,
    });
    vm.on('console.log', this.getMode() === 'manual'
        ? this.sendMessageToUI
        : CODE_ENABLE_STDOUT === 'true'
            ? (...args) => console.log(`[Workflow "${this.getWorkflow().id}"][Node "${this.getNode().name}"]`, ...args)
            : () => { });
    try {
        const scriptResult = await vm.run(`module.exports = async function() { ${scriptCode}\n}()`);
        if (!Array.isArray(scriptResult)) {
            return handleError.call(this, new Error('Custom script must return an array of items. Please ensure your script returns an array, e.g., return [{ key: value }].'), itemIndex, undefined, page);
        }
        return this.helpers.normalizeItems(scriptResult);
    }
    catch (error) {
        return handleError.call(this, error, itemIndex, undefined, page);
    }
}
async function processPageOperation(operation, url, page, itemIndex, options) {
    const waitUntil = options.waitUntil;
    const timeout = options.timeout;
    try {
        const response = await page.goto(url.toString(), {
            waitUntil,
            timeout,
        });
        const headers = await (response === null || response === void 0 ? void 0 : response.headers());
        const statusCode = response === null || response === void 0 ? void 0 : response.status();
        if (!response || (statusCode && statusCode >= 400)) {
            return handleError.call(this, new Error(`Request failed with status code ${statusCode || 0}`), itemIndex, url.toString(), page);
        }
        if (operation === 'getPageContent') {
            const body = await page.content();
            return [{
                    json: {
                        body,
                        headers,
                        statusCode,
                        url: url.toString(),
                    },
                    pairedItem: {
                        item: itemIndex,
                    },
                }];
        }
        if (operation === 'getScreenshot') {
            try {
                const dataPropertyName = this.getNodeParameter('dataPropertyName', itemIndex);
                const fileName = options.fileName;
                const type = this.getNodeParameter('imageType', itemIndex);
                const fullPage = this.getNodeParameter('fullPage', itemIndex);
                const screenshotOptions = {
                    type,
                    fullPage,
                };
                if (type !== 'png') {
                    const quality = this.getNodeParameter('quality', itemIndex);
                    screenshotOptions.quality = quality;
                }
                if (fileName) {
                    screenshotOptions.path = fileName;
                }
                const screenshot = await page.screenshot(screenshotOptions);
                if (screenshot) {
                    const binaryData = await this.helpers.prepareBinaryData(Buffer.from(screenshot), screenshotOptions.path, `image/${type}`);
                    return [{
                            binary: { [dataPropertyName]: binaryData },
                            json: {
                                headers,
                                statusCode,
                                url: url.toString(),
                            },
                            pairedItem: {
                                item: itemIndex,
                            },
                        }];
                }
            }
            catch (error) {
                return handleError.call(this, error, itemIndex, url.toString(), page);
            }
        }
        if (operation === 'getPDF') {
            try {
                const dataPropertyName = this.getNodeParameter('dataPropertyName', itemIndex);
                const pageRanges = this.getNodeParameter('pageRanges', itemIndex);
                const displayHeaderFooter = this.getNodeParameter('displayHeaderFooter', itemIndex);
                const omitBackground = this.getNodeParameter('omitBackground', itemIndex);
                const printBackground = this.getNodeParameter('printBackground', itemIndex);
                const landscape = this.getNodeParameter('landscape', itemIndex);
                const preferCSSPageSize = this.getNodeParameter('preferCSSPageSize', itemIndex);
                const scale = this.getNodeParameter('scale', itemIndex);
                const margin = this.getNodeParameter('margin', 0, {});
                let headerTemplate = '';
                let footerTemplate = '';
                let height = '';
                let width = '';
                let format = 'A4';
                if (displayHeaderFooter === true) {
                    headerTemplate = this.getNodeParameter('headerTemplate', itemIndex);
                    footerTemplate = this.getNodeParameter('footerTemplate', itemIndex);
                }
                if (preferCSSPageSize !== true) {
                    height = this.getNodeParameter('height', itemIndex);
                    width = this.getNodeParameter('width', itemIndex);
                    if (!height || !width) {
                        format = this.getNodeParameter('format', itemIndex);
                    }
                }
                const pdfOptions = {
                    format,
                    displayHeaderFooter,
                    omitBackground,
                    printBackground,
                    landscape,
                    headerTemplate,
                    footerTemplate,
                    preferCSSPageSize,
                    scale,
                    height,
                    width,
                    pageRanges,
                    margin,
                };
                const fileName = options.fileName;
                if (fileName) {
                    pdfOptions.path = fileName;
                }
                const pdf = await page.pdf(pdfOptions);
                if (pdf) {
                    const binaryData = await this.helpers.prepareBinaryData(Buffer.from(pdf), pdfOptions.path, 'application/pdf');
                    return [{
                            binary: { [dataPropertyName]: binaryData },
                            json: {
                                headers,
                                statusCode,
                                url: url.toString(),
                            },
                            pairedItem: {
                                item: itemIndex,
                            },
                        }];
                }
            }
            catch (error) {
                return handleError.call(this, error, itemIndex, url.toString(), page);
            }
        }
        return handleError.call(this, new Error(`Unsupported operation: ${operation}`), itemIndex, url.toString(), page);
    }
    catch (error) {
        return handleError.call(this, error, itemIndex, url.toString(), page);
    }
}
class Puppeteer {
    constructor() {
        this.description = Puppeteer_node_options_1.nodeDescription;
        this.methods = {
            loadOptions: {
                async getDevices() {
                    const deviceNames = Object.keys(puppeteer_1.KnownDevices);
                    const returnData = [];
                    for (const name of deviceNames) {
                        const device = puppeteer_1.KnownDevices[name];
                        returnData.push({
                            name,
                            value: name,
                            description: `${device.viewport.width} x ${device.viewport.height} @ ${device.viewport.deviceScaleFactor}x`,
                        });
                    }
                    return returnData;
                },
            },
        };
    }
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        const options = this.getNodeParameter('options', 0, {});
        const operation = this.getNodeParameter('operation', 0);
        let headless = options.headless !== false;
        const headlessShell = options.shell === true;
        const executablePath = options.executablePath;
        const browserWSEndpoint = options.browserWSEndpoint;
        const stealth = options.stealth === true;
        const humanTyping = options.humanTyping === true;
        const humanTypingOptions = Object.assign({ keyboardLayout: "en" }, (options.humanTypingOptions || {}));
        const launchArguments = options.launchArguments || {};
        const launchArgs = launchArguments.args;
        const args = [];
        const device = options.device;
        const protocolTimeout = options.protocolTimeout;
        let batchSize = options.batchSize;
        if (!Number.isInteger(batchSize) || batchSize < 1) {
            batchSize = 1;
        }
        if (launchArgs && launchArgs.length > 0) {
            args.push(...launchArgs.map((arg) => arg.arg));
        }
        const addContainerArgs = options.addContainerArgs === true;
        if (addContainerArgs) {
            const missingContainerArgs = CONTAINER_LAUNCH_ARGS.filter(arg => !args.some(existingArg => existingArg === arg || existingArg.startsWith(`${arg}=`)));
            if (missingContainerArgs.length > 0) {
                console.log('Puppeteer node: Adding container optimizations:', missingContainerArgs);
                args.push(...missingContainerArgs);
            }
            else {
                console.log('Puppeteer node: Container optimizations already present in launch arguments');
            }
        }
        if (options.proxyServer) {
            args.push(`--proxy-server=${options.proxyServer}`);
        }
        if (stealth) {
            puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_stealth_1.default)());
        }
        if (humanTyping) {
            puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_human_typing_1.default)(humanTypingOptions));
        }
        if (headless && headlessShell) {
            headless = 'shell';
        }
        let browser;
        try {
            if (browserWSEndpoint) {
                browser = await puppeteer_extra_1.default.connect({
                    browserWSEndpoint,
                    protocolTimeout,
                });
            }
            else {
                browser = await puppeteer_extra_1.default.launch({
                    headless,
                    args,
                    executablePath,
                    protocolTimeout,
                });
            }
        }
        catch (error) {
            throw new Error(`Failed to launch/connect to browser: ${error.message}`);
        }
        const processItem = async (item, itemIndex) => {
            let page;
            try {
                page = await browser.newPage();
                await handleOptions.call(this, itemIndex, items, browser, page);
                if (operation === 'runCustomScript') {
                    console.log(`Processing ${itemIndex + 1} of ${items.length}: [${operation}]${device ? ` [${device}] ` : ' '} Custom Script`);
                    return await runCustomScript.call(this, itemIndex, items, browser, page);
                }
                const urlString = this.getNodeParameter('url', itemIndex);
                const queryParametersOptions = this.getNodeParameter('queryParameters', itemIndex, {});
                const queryParameters = queryParametersOptions.parameters || [];
                let url;
                try {
                    url = new URL(urlString);
                    for (const queryParameter of queryParameters) {
                        url.searchParams.append(queryParameter.name, queryParameter.value);
                    }
                }
                catch (error) {
                    return handleError.call(this, new Error(`Invalid URL: ${urlString}`), itemIndex, urlString, page);
                }
                console.log(`Processing ${itemIndex + 1} of ${items.length}: [${operation}]${device ? ` [${device}] ` : ' '}${url}`);
                return await processPageOperation.call(this, operation, url, page, itemIndex, options);
            }
            catch (error) {
                return handleError.call(this, error, itemIndex, undefined, page);
            }
            finally {
                if (page) {
                    try {
                        await page.close();
                    }
                    catch (error) {
                        console.error('Error closing page:', error);
                    }
                }
            }
        };
        try {
            for (let i = 0; i < items.length; i += batchSize) {
                const batch = items.slice(i, i + batchSize);
                const results = await Promise.all(batch.map((item, idx) => processItem(item, i + idx)));
                if (results === null || results === void 0 ? void 0 : results.length) {
                    returnData.push(...results.flat());
                }
            }
        }
        finally {
            if (browser) {
                try {
                    if (browserWSEndpoint) {
                        await browser.disconnect();
                    }
                    else {
                        await browser.close();
                    }
                }
                catch (error) {
                    console.error('Error closing browser:', error);
                }
            }
        }
        return this.prepareOutputData(returnData);
    }
}
exports.Puppeteer = Puppeteer;
//# sourceMappingURL=Puppeteer.node.js.map