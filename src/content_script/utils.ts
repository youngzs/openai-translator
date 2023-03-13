import { createParser } from 'eventsource-parser'
import { userscriptFetch } from '../common/userscript-polyfill'
import { isDesktopApp, isUserscript } from '../common/utils'
import { containerTagName, popupCardID, popupThumbID, zIndex } from './consts'
import browser from 'webextension-polyfill'

function attachEventsToContainer($container: HTMLElement) {
    $container.addEventListener('mousedown', (event) => {
        event.stopPropagation()
    })
    $container.addEventListener('mouseup', (event) => {
        event.stopPropagation()
    })
}

export async function getContainer(): Promise<HTMLElement> {
    let $container: HTMLElement | null = document.querySelector(containerTagName)
    if (!$container) {
        $container = document.createElement(containerTagName)
        attachEventsToContainer($container)
        $container.style.zIndex = zIndex
        return new Promise((resolve) => {
            setTimeout(() => {
                const $container_: HTMLElement | null = document.querySelector(containerTagName)
                if ($container_) {
                    resolve($container_)
                    return
                }
                const $html = document.body.parentElement
                if ($html) {
                    $html.appendChild($container as HTMLElement)
                } else {
                    document.appendChild($container as HTMLElement)
                }
                resolve($container as HTMLElement)
            }, 100)
        })
    }
    return new Promise((resolve) => {
        resolve($container as HTMLElement)
    })
}

export async function queryPopupThumbElement(): Promise<HTMLDivElement | null> {
    const $container = await getContainer()
    return $container.querySelector(`#${popupThumbID}`) as HTMLDivElement | null
}

export async function queryPopupCardElement(): Promise<HTMLDivElement | null> {
    const $container = await getContainer()
    return $container.querySelector(`#${popupCardID}`) as HTMLDivElement | null
}

export async function* streamAsyncIterable(stream: ReadableStream<Uint8Array> | null) {
    if (!stream) {
        return
    }
    const reader = stream.getReader()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                return
            }
            yield value
        }
    } finally {
        reader.releaseLock()
    }
}

const streamAsyncIterator = {
    [Symbol.asyncIterator]: streamAsyncIterable,
}

interface FetchSSEOptions extends RequestInit {
    onMessage(data: string): void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError(error: any): void
}

function backgroundFetch(input: string, options: FetchSSEOptions) {
    return new Promise((_resolve, reject) => {
        const { onMessage, onError, signal, ...fetchOptions } = options

        const port = browser.runtime.connect({ name: 'background-fetch' })
        port.postMessage({ type: 'open', details: { url: input, options: fetchOptions } })
        port.onMessage.addListener(function (msg) {
            if (msg.error) {
                const error = new Error()
                error.message = msg.error.message
                error.name = msg.error.name
                reject(error)
                return
            }
            if (msg.status !== 200) {
                onError(msg)
            } else {
                onMessage(msg.response)
            }
        })

        function handleAbort() {
            port.postMessage({ type: 'abort' })
        }
        port.onDisconnect.addListener(() => {
            signal?.removeEventListener('abort', handleAbort)
        })
        signal?.addEventListener('abort', handleAbort)
    })
}

export async function fetchSSE(input: string, options: FetchSSEOptions) {
    const { onMessage, onError, ...fetchOptions } = options

    if (!isDesktopApp() && !isUserscript()) {
        await backgroundFetch(input, options)
    } else {
        const fetch = isUserscript() ? userscriptFetch : window.fetch
        const resp = await fetch(input, fetchOptions)
        if (resp.status !== 200) {
            onError(await resp.json())
            return
        }
        const parser = createParser((event) => {
            if (event.type === 'event') {
                onMessage(event.data)
            }
        })
        for await (const chunk of streamAsyncIterator[Symbol.asyncIterator](resp.body)) {
            const str = new TextDecoder().decode(chunk)
            parser.feed(str)
        }
    }
}

export function calculateMaxTop($popupCard: HTMLElement): number {
    const { innerHeight } = window
    const { scrollTop } = document.documentElement
    const { height } = $popupCard.getBoundingClientRect()
    return scrollTop + innerHeight - height - 10
}
