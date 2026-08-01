import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ValidatedCompanionProfile } from "./profiles/types";
import type { OverlayGeometry } from "./runtime/geometry";
import Pets from "./scenes/Pets";

interface PhaserWrapperProps {
    readonly profile: ValidatedCompanionProfile;
    readonly geometry: OverlayGeometry;
    readonly onReady: () => void;
    readonly onAbort: () => void;
}

function PhaserWrapper({ profile, geometry, onReady, onAbort }: PhaserWrapperProps) {
    const phaserHost = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!phaserHost.current) return;
        void getCurrentWebviewWindow().setIgnoreCursorEvents(true).catch(onAbort);

        const game = new Phaser.Game({
            type: Phaser.AUTO,
            parent: phaserHost.current,
            backgroundColor: "#00000000",
            transparent: true,
            roundPixels: true,
            antialias: true,
            scale: {
                mode: Phaser.Scale.ScaleModes.RESIZE,
                width: geometry.monitor.width,
                height: geometry.monitor.height,
            },
            physics: {
                default: "arcade",
                arcade: {
                    debug: false,
                    gravity: profile.behavior.gravity,
                },
            },
            fps: {
                target: 30,
                min: 30,
                smoothStep: true,
            },
            scene: [Pets],
            audio: { noAudio: true },
            callbacks: {
                preBoot: (bootingGame) => {
                    bootingGame.registry.set("profile", profile);
                    bootingGame.registry.set("geometry", geometry);
                    bootingGame.registry.set("startupReady", onReady);
                    bootingGame.registry.set("startupAbort", onAbort);
                },
            },
        });

        return () => {
            game.destroy(true);
            if (phaserHost.current) phaserHost.current.innerHTML = "";
        };
    }, [geometry, onAbort, onReady, profile]);

    return <div id="phaser-container" ref={phaserHost} />;
}

export default PhaserWrapper;
