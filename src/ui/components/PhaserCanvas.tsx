import Phaser from "phaser";
import { memo, useEffect, useRef, useState } from "react";
import { Pet } from "../../scenes/Pet";
import { CanvasSize } from "../../utils";
import { PhaserCanvasProps } from "../../types/components/type";

function PhaserCanvas({ pet, playState }: PhaserCanvasProps) {
    const phaserDom = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (phaserDom.current === null) return;
        const phaserConfig: Phaser.Types.Core.GameConfig = {
            type: Phaser.CANVAS,
            parent: phaserDom.current,
            transparent: true,
            roundPixels: true,
            antialias: true,
            scale: {
                width: CanvasSize,
                height: CanvasSize,
            },
            physics: {
                default: 'arcade',
                arcade: {
                    debug: false,
                    gravity: { y: 200, x: 0 },
                },
            },
            fps: {
                target: 30,
                min: 30,
                smoothStep: true,
            },
            scene: [Pet],
            audio: {
                noAudio: true,
            },
            callbacks: {
                preBoot: (game) => {
                    game.registry.set('spriteConfig', pet);
                    game.registry.set('playState', playState);
                }
            }
        }

        const game = new Phaser.Game(phaserConfig);

        return () => {
            // Every card owns its Phaser instance, so destroy it when the preview leaves view.
            game.destroy(true);
            if (phaserDom.current !== null) phaserDom.current.innerHTML = '';
        }
    }, [pet, playState]);

    return (
        <div style={{
            // Keep page scrolling available when the pointer crosses a preview canvas.
            pointerEvents: 'none',
        }} ref={phaserDom} key={pet.id ?? pet.name}></div>
    )
}

export default memo(PhaserCanvas);
