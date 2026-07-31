import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import Pets from "./scenes/Pets";
import { useSettingStore } from "./hooks/useSettingStore";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
const appWindow = getCurrentWebviewWindow()

// React owns pet data while Phaser owns rendering, and the game registry is their handoff.
function PhaserWrapper() {
    const phaserDom = useRef<HTMLDivElement>(null);
    const { pets } = useSettingStore();

    const [screenWidth, setScreenWidth] = useState(window.screen.width);
    const [screenHeight, setScreenHeight] = useState(window.screen.height);

    useEffect(() => {
        if (!phaserDom.current) return;

        const handleResize = () => {
            setScreenWidth(window.screen.width);
            setScreenHeight(window.screen.height);
        };

        window.addEventListener("resize", handleResize);

        // Reset click-through because Phaser may have temporarily enabled pointer input before remounting.
        appWindow.setIgnoreCursorEvents(true);

        const phaserConfig: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            parent: phaserDom.current,
            backgroundColor: '#ffffff0',
            transparent: true,
            roundPixels: true,
            antialias: true,
            scale: {
                mode: Phaser.Scale.ScaleModes.RESIZE,
                width: screenWidth,
                height: screenHeight,
            },
            physics: {
                default: 'arcade',
                arcade: {
                    debug: false,
                    gravity: { y: 200, x: 0},
                },
            },
            fps: {
                target: 30,
                min: 30,
                smoothStep: true,
            },
            scene: [Pets],
            audio: {
                noAudio: true,
            },
            callbacks: {
                preBoot: (game) => {
                    // The Pets scene reads this snapshot during preload before creating desktop sprites.
                    game.registry.set('spriteConfig', pets);
                }
            }
        }

        const game = new Phaser.Game(phaserConfig);

        return () => {
            // Phaser owns the canvas, so destroy the game before React clears its host node.
            game.destroy(true);
            if (phaserDom.current !== null) phaserDom.current.innerHTML = '';
            window.removeEventListener("resize", handleResize);
        }

    }, [pets, screenWidth, screenHeight]);

    return (
        <>
            <div ref={phaserDom} />
        </>
    )
}

export default PhaserWrapper;
