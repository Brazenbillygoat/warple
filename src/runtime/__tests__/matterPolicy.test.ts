import { describe, expect, it } from "vitest";
// @ts-expect-error Phaser does not publish declarations for its embedded Matter CommonJS module.
import MatterRuntime from "phaser/src/physics/matter-js/CustomMain.js";
import {
    MATTER_FIXED_DELTA_MS,
    MATTER_FIXED_HZ,
    aggregateCollisionContacts,
    clampBodyCenterToRectangle,
    clampFiniteVector,
    createMatterGravity,
    finiteVectorOrZero,
    filterCollisionSamplesByOtherBody,
    matterForceForSemanticAcceleration,
    matterVelocityToPixelsPerSecond,
    mergeCollisionSamplesForPolicy,
    normalizeCollisionContact,
    pixelsPerSecondToMatterVelocity,
    pixelsPerSecondVectorToMatterVelocity,
    selectContactTransition,
    suppressContactDirection,
    type CollisionSample,
} from "../matterPolicy";

type RuntimeCompositeMember = MatterJS.BodyType | MatterJS.ConstraintType;

type RuntimeEngine = Omit<MatterJS.Engine, "world" | "pairs"> & {
    readonly world: MatterJS.CompositeType;
    readonly gravity: MatterJS.Vector & { scale: number };
    readonly pairs: { readonly list: Phaser.Types.Physics.Matter.MatterCollisionPair[] };
};

interface MatterModules {
    readonly Engine: {
        create(): RuntimeEngine;
        update(engine: RuntimeEngine, delta?: number): RuntimeEngine;
    };
    readonly Bodies: {
        rectangle(
            x: number,
            y: number,
            width: number,
            height: number,
            options?: MatterJS.IBodyDefinition,
        ): MatterJS.BodyType;
    };
    readonly Body: {
        applyForce(
            body: MatterJS.BodyType,
            position: MatterJS.Vector,
            force: MatterJS.Vector,
        ): void;
        setStatic(body: MatterJS.BodyType, isStatic: boolean): void;
        setPosition(body: MatterJS.BodyType, position: MatterJS.Vector): void;
        setVelocity(body: MatterJS.BodyType, velocity: MatterJS.Vector): void;
        setAngularVelocity(body: MatterJS.BodyType, velocity: number): void;
    };
    readonly Composite: {
        add(
            composite: MatterJS.CompositeType,
            object: RuntimeCompositeMember | readonly RuntimeCompositeMember[],
        ): void;
        remove(composite: MatterJS.CompositeType, object: RuntimeCompositeMember): void;
    };
    readonly Constraint: {
        create(options: MatterJS.IConstraintDefinition): MatterJS.ConstraintType;
    };
    readonly Events: {
        on(
            object: RuntimeEngine,
            eventName: string,
            callback: (event: {
                readonly pairs?: readonly Phaser.Types.Physics.Matter.MatterCollisionPair[];
            }) => void,
        ): void;
    };
}

interface VectorWithScale {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
}

const Matter = MatterRuntime as MatterModules;

function createEngine(gravity: VectorWithScale = { x: 0, y: 0, scale: 0 }): RuntimeEngine {
    const engine = Matter.Engine.create();
    engine.gravity.x = gravity.x;
    engine.gravity.y = gravity.y;
    engine.gravity.scale = gravity.scale;
    return engine;
}

function step(engine: RuntimeEngine, count: number): void {
    for (let index = 0; index < count; index += 1) {
        Matter.Engine.update(engine, MATTER_FIXED_DELTA_MS);
    }
}

describe("Matter semantic conversion policy", () => {
    it("converts current semantic speeds to a 60 Hz Matter velocity", () => {
        expect(MATTER_FIXED_HZ).toBe(60);
        expect(pixelsPerSecondToMatterVelocity(54)).toBeCloseTo(0.9);
        expect(pixelsPerSecondVectorToMatterVelocity({ x: 0, y: 1200 }, 1200)).toEqual({
            x: 0,
            y: 20,
        });
        expect(matterVelocityToPixelsPerSecond({ x: 0.9, y: -20 })).toEqual({
            x: 54,
            y: -1200,
        });
    });

    it("bounds vectors by total magnitude and rejects unsafe values", () => {
        expect(clampFiniteVector({ x: 3000, y: 4000 }, 1200)).toEqual({ x: 720, y: 960 });
        expect(finiteVectorOrZero({ x: Number.NaN, y: 2 })).toEqual({ x: 0, y: 0 });
        expect(pixelsPerSecondVectorToMatterVelocity({ x: Infinity, y: 2 })).toEqual({
            x: 0,
            y: 0,
        });
        expect(pixelsPerSecondToMatterVelocity(100, Number.NaN)).toBe(0);
    });

    it("keeps gravity and extra acceleration conversions explicit", () => {
        expect(createMatterGravity({ x: 0, y: 200 })).toEqual({
            x: 0,
            y: 200,
            scale: 0.000001,
        });
        expect(matterForceForSemanticAcceleration({ x: 0, y: 108 }, 2)).toEqual({
            x: 0,
            y: 0.000216,
        });
        expect(matterForceForSemanticAcceleration({ x: 0, y: 108 }, Number.NaN)).toEqual({
            x: 0,
            y: 0,
        });
    });

    it("clamps a body center without allowing invalid geometry through", () => {
        expect(
            clampBodyCenterToRectangle(
                { x: -50, y: 900 },
                { x: 20, y: 30 },
                { x: 10, y: 20, width: 300, height: 200 },
            ),
        ).toEqual({ x: 30, y: 190 });
        expect(
            clampBodyCenterToRectangle(
                { x: 10, y: 10 },
                { x: 20, y: 20 },
                { x: 0, y: 0, width: 10, height: 10 },
            ),
        ).toEqual({ x: 0, y: 0 });
    });
});

describe("Matter collision policy", () => {
    const topContact = {
        pairId: "top",
        bodyAId: 1,
        bodyBId: 2,
        bodyALabel: "companion",
        bodyBLabel: "ceiling",
        normal: { x: 0, y: 1 },
    } as const;

    it("normalizes a contact when the companion is body A", () => {
        expect(normalizeCollisionContact(topContact, 1)).toMatchObject({
            otherBodyId: 2,
            otherLabel: "ceiling",
            normal: { x: 0, y: -1 },
            directions: ["up"],
        });
    });

    it("produces the same contact when Matter reverses body ordering", () => {
        expect(
            normalizeCollisionContact(
                {
                    ...topContact,
                    bodyAId: 2,
                    bodyBId: 1,
                    bodyALabel: "ceiling",
                    bodyBLabel: "companion",
                    normal: { x: 0, y: -1 },
                },
                1,
            ),
        ).toMatchObject({
            otherBodyId: 2,
            otherLabel: "ceiling",
            normal: { x: 0, y: -1 },
            directions: ["up"],
        });
    });

    it("aggregates simultaneous corner contacts deterministically", () => {
        const contacts = aggregateCollisionContacts(
            [
                topContact,
                {
                    pairId: "right",
                    bodyAId: 3,
                    bodyBId: 1,
                    bodyALabel: "right-wall",
                    bodyBLabel: "companion",
                    normal: { x: 1, y: 0 },
                },
            ],
            1,
        );

        expect(contacts).toMatchObject({ up: true, down: false, left: false, right: true });
        expect(contacts.normalized.map((contact) => contact.pairId)).toEqual(["right", "top"]);
    });

    it("keeps dynamic objects out of declarative surface policy", () => {
        const samples = [
            topContact,
            {
                pairId: "ball",
                bodyAId: 1,
                bodyBId: 3,
                bodyALabel: "companion",
                bodyBLabel: "test-ball",
                normal: { x: 0, y: 1 },
            },
        ];

        expect(
            filterCollisionSamplesByOtherBody(samples, 1, new Set([2])).map(
                (sample) => sample.pairId,
            ),
        ).toEqual(["top"]);
    });

    it("retains a transient impact for one policy tick", () => {
        const samples = mergeCollisionSamplesForPolicy([], [topContact]);
        const contacts = aggregateCollisionContacts(samples, 1);

        expect(
            selectContactTransition("airborne", contacts, {
                crawlEdgeDeparture: true,
                ceilingToCrawl: true,
            }),
        ).toBe("ceiling-crawl");
        expect(
            mergeCollisionSamplesForPolicy(
                [topContact],
                [{ ...topContact, bodyBLabel: "latest-ceiling" }],
            ),
        ).toEqual([{ ...topContact, bodyBLabel: "latest-ceiling" }]);
    });

    it("applies crawl, ceiling, floor, then side precedence", () => {
        const options = { crawlEdgeDeparture: true, ceilingToCrawl: true };
        expect(
            selectContactTransition(
                "crawling",
                { up: true, down: false, left: false, right: true },
                options,
            ),
        ).toBe("crawl-edge-departure");
        expect(
            selectContactTransition(
                "airborne",
                { up: true, down: true, left: false, right: true },
                options,
            ),
        ).toBe("ceiling-crawl");
        expect(
            selectContactTransition(
                "airborne",
                { up: false, down: true, left: true, right: false },
                options,
            ),
        ).toBe("landing");
        expect(
            selectContactTransition(
                "airborne",
                { up: false, down: false, left: true, right: false },
                options,
            ),
        ).toBe("side");
        expect(
            selectContactTransition(
                "dragged",
                { up: true, down: true, left: true, right: true },
                options,
            ),
        ).toBe("none");
    });

    it("suppresses either latched wall during corner handoff", () => {
        const contacts = aggregateCollisionContacts(
            [
                topContact,
                {
                    pairId: "right",
                    bodyAId: 3,
                    bodyBId: 1,
                    normal: { x: 1, y: 0 },
                },
            ],
            1,
        );

        expect(suppressContactDirection(contacts, "right")).toMatchObject({
            up: true,
            right: false,
        });
        expect(suppressContactDirection({ ...contacts, left: true }, "left")).toMatchObject({
            up: true,
            left: false,
        });
    });
});

describe("fixed-step Matter integration", () => {
    it("latches a ceiling impact that ends before the next 30 Hz policy tick", () => {
        const engine = createEngine(createMatterGravity({ x: 0, y: 200 }));
        const ceiling = Matter.Bodies.rectangle(200, -20, 480, 40, {
            isStatic: true,
            slop: 0,
            label: "ceiling",
        });
        const companion = Matter.Bodies.rectangle(200, 120, 90, 90, {
            frictionAir: 0,
            restitution: 0,
            slop: 0,
            label: "companion",
        });
        Matter.Composite.add(engine.world, [ceiling, companion]);
        Matter.Body.setVelocity(companion, { x: 0, y: -20 });

        const activeSamples = new Map<string, CollisionSample>();
        const pendingImpactSamples = new Map<string, CollisionSample>();
        const updateSamples = (
            event: {
                readonly pairs?: readonly Phaser.Types.Physics.Matter.MatterCollisionPair[];
            },
            latchImpact: boolean,
        ) => {
            for (const pair of event.pairs ?? []) {
                const sample = {
                    pairId: pair.id,
                    bodyAId: pair.bodyA.id,
                    bodyBId: pair.bodyB.id,
                    bodyALabel: pair.bodyA.label,
                    bodyBLabel: pair.bodyB.label,
                    normal: pair.collision.normal,
                };
                activeSamples.set(pair.id, sample);
                if (latchImpact) pendingImpactSamples.set(pair.id, sample);
            }
        };
        Matter.Events.on(engine, "beforeUpdate", () => {
            Matter.Body.applyForce(
                companion,
                companion.position,
                matterForceForSemanticAcceleration({ x: 0, y: 108 }, companion.mass),
            );
        });
        Matter.Events.on(engine, "collisionStart", (event) => updateSamples(event, true));
        Matter.Events.on(engine, "collisionActive", (event) => updateSamples(event, false));
        Matter.Events.on(engine, "collisionEnd", (event) => {
            for (const pair of event.pairs ?? []) activeSamples.delete(pair.id);
        });

        step(engine, 6);

        expect(activeSamples.size).toBe(0);
        expect(pendingImpactSamples.size).toBe(1);
        const contacts = aggregateCollisionContacts(
            mergeCollisionSamplesForPolicy(
                activeSamples.values(),
                pendingImpactSamples.values(),
            ),
            companion.id,
        );
        expect(
            selectContactTransition("airborne", contacts, {
                crawlEdgeDeparture: true,
                ceilingToCrawl: true,
            }),
        ).toBe("ceiling-crawl");
    });

    it("maintains a climbing contact with a small inward velocity", () => {
        const engine = createEngine();
        const wall = Matter.Bodies.rectangle(20, 200, 20, 400, {
            isStatic: true,
            slop: 0,
        });
        const companion = Matter.Bodies.rectangle(44, 250, 30, 30, {
            frictionAir: 0,
            slop: 0,
        });
        Matter.Composite.add(engine.world, [wall, companion]);
        const startY = companion.position.y;

        for (let index = 0; index < MATTER_FIXED_HZ; index += 1) {
            Matter.Body.setVelocity(
                companion,
                pixelsPerSecondVectorToMatterVelocity({ x: -6, y: -54 }),
            );
            step(engine, 1);
        }

        const wallPairActive = engine.pairs.list.some(
            (pair) =>
                pair.isActive &&
                ((pair.bodyA.id === wall.id && pair.bodyB.id === companion.id) ||
                    (pair.bodyB.id === wall.id && pair.bodyA.id === companion.id)),
        );
        expect(wallPairActive).toBe(true);
        expect(startY - companion.position.y).toBeGreaterThan(45);
    });

    it("classifies real Matter floor and ceiling pairs by contacted side", () => {
        const floorEngine = createEngine();
        const floor = Matter.Bodies.rectangle(100, 120, 180, 20, {
            isStatic: true,
            slop: 0,
            label: "floor",
        });
        const floorCompanion = Matter.Bodies.rectangle(100, 104, 30, 30, {
            slop: 0,
            label: "companion",
        });
        Matter.Composite.add(floorEngine.world, [floor, floorCompanion]);
        step(floorEngine, 1);
        const floorPair = floorEngine.pairs.list.find((pair) => pair.isActive);
        expect(floorPair).toBeDefined();
        const floorContacts = aggregateCollisionContacts(
            [
                {
                    pairId: floorPair!.id,
                    bodyAId: floorPair!.bodyA.id,
                    bodyBId: floorPair!.bodyB.id,
                    bodyALabel: floorPair!.bodyA.label,
                    bodyBLabel: floorPair!.bodyB.label,
                    normal: floorPair!.collision.normal,
                },
            ],
            floorCompanion.id,
        );
        expect(floorContacts).toMatchObject({
            up: false,
            down: true,
            left: false,
            right: false,
        });

        const ceilingEngine = createEngine();
        const ceilingCompanion = Matter.Bodies.rectangle(100, 36, 30, 30, {
            slop: 0,
            label: "companion",
        });
        const ceiling = Matter.Bodies.rectangle(100, 20, 180, 20, {
            isStatic: true,
            slop: 0,
            label: "ceiling",
        });
        Matter.Composite.add(ceilingEngine.world, [ceilingCompanion, ceiling]);
        step(ceilingEngine, 1);
        const ceilingPair = ceilingEngine.pairs.list.find((pair) => pair.isActive);
        expect(ceilingPair).toBeDefined();
        const ceilingContacts = aggregateCollisionContacts(
            [
                {
                    pairId: ceilingPair!.id,
                    bodyAId: ceilingPair!.bodyA.id,
                    bodyBId: ceilingPair!.bodyB.id,
                    bodyALabel: ceilingPair!.bodyA.label,
                    bodyBLabel: ceilingPair!.bodyB.label,
                    normal: ceilingPair!.collision.normal,
                },
            ],
            ceilingCompanion.id,
        );
        expect(ceilingContacts).toMatchObject({
            up: true,
            down: false,
            left: false,
            right: false,
        });
    });

    it("classifies real Matter contacts on both side walls", () => {
        const cases = [
            {
                wallX: 20,
                companionX: 44,
                expected: { left: true, right: false },
            },
            {
                wallX: 180,
                companionX: 156,
                expected: { left: false, right: true },
            },
        ] as const;

        for (const testCase of cases) {
            const engine = createEngine();
            const wall = Matter.Bodies.rectangle(testCase.wallX, 100, 20, 180, {
                isStatic: true,
                slop: 0,
                label: "wall",
            });
            const companion = Matter.Bodies.rectangle(testCase.companionX, 100, 30, 30, {
                slop: 0,
                label: "companion",
            });
            Matter.Composite.add(engine.world, [wall, companion]);
            step(engine, 1);
            const pair = engine.pairs.list.find((candidate) => candidate.isActive);
            expect(pair).toBeDefined();

            const contacts = aggregateCollisionContacts(
                [
                    {
                        pairId: pair!.id,
                        bodyAId: pair!.bodyA.id,
                        bodyBId: pair!.bodyB.id,
                        bodyALabel: pair!.bodyA.label,
                        bodyBLabel: pair!.bodyB.label,
                        normal: pair!.collision.normal,
                    },
                ],
                companion.id,
            );
            expect(contacts).toMatchObject({
                up: false,
                down: false,
                ...testCase.expected,
            });
        }
    });

    it("keeps a real dynamic collision outside registered surface policy", () => {
        const engine = createEngine();
        const companion = Matter.Bodies.rectangle(100, 100, 30, 30, {
            slop: 0,
            label: "companion",
        });
        const dynamicObject = Matter.Bodies.rectangle(124, 100, 30, 30, {
            slop: 0,
            label: "dynamic-object",
        });
        Matter.Composite.add(engine.world, [companion, dynamicObject]);
        step(engine, 1);
        const pair = engine.pairs.list.find((candidate) => candidate.isActive);
        expect(pair).toBeDefined();

        const samples = [
            {
                pairId: pair!.id,
                bodyAId: pair!.bodyA.id,
                bodyBId: pair!.bodyB.id,
                bodyALabel: pair!.bodyA.label,
                bodyBLabel: pair!.bodyB.label,
                normal: pair!.collision.normal,
            },
        ];
        expect(filterCollisionSamplesByOtherBody(samples, companion.id, new Set())).toEqual([]);
    });

    it("measures 60 semantic pixels of displacement in one second", () => {
        const engine = createEngine();
        const body = Matter.Bodies.rectangle(50, 50, 20, 20, { frictionAir: 0 });
        Matter.Composite.add(engine.world, body);
        Matter.Body.setVelocity(body, pixelsPerSecondVectorToMatterVelocity({ x: 60, y: 0 }));

        step(engine, MATTER_FIXED_HZ);

        expect(body.position.x - 50).toBeCloseTo(60, 5);
        expect(body.position.y).toBeCloseTo(50, 5);
    });

    it("measures configured gravity over fixed steps", () => {
        const engine = createEngine(createMatterGravity({ x: 0, y: 200 }));
        const body = Matter.Bodies.rectangle(50, 50, 20, 20, { frictionAir: 0 });
        Matter.Composite.add(engine.world, body);

        step(engine, MATTER_FIXED_HZ);

        expect(matterVelocityToPixelsPerSecond(body.velocity).y).toBeCloseTo(200, 4);
        expect(body.position.y - 50).toBeGreaterThan(95);
        expect(body.position.y - 50).toBeLessThan(105);
    });

    it("restores a directly dragged body dynamically at the exact release position", () => {
        const body = Matter.Bodies.rectangle(30, 30, 20, 20, { frictionAir: 0 });
        Matter.Body.setStatic(body, true);
        Matter.Body.setPosition(body, { x: 170, y: 140 });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(body, 0);
        Matter.Body.setStatic(body, false);
        Matter.Body.setPosition(body, { x: 170, y: 140 });
        Matter.Body.setVelocity(body, pixelsPerSecondVectorToMatterVelocity({ x: 600, y: -300 }));

        expect(body.position).toMatchObject({ x: 170, y: 140 });
        expect(matterVelocityToPixelsPerSecond(body.velocity)).toEqual({ x: 600, y: -300 });
    });

    it("contains a maximum-speed throw inside thick work-area walls", () => {
        const engine = createEngine();
        const body = Matter.Bodies.rectangle(200, 200, 40, 40, {
            frictionAir: 0,
            restitution: 0,
            slop: 0,
        });
        const walls = [
            Matter.Bodies.rectangle(200, -20, 480, 40, { isStatic: true, slop: 0 }),
            Matter.Bodies.rectangle(200, 420, 480, 40, { isStatic: true, slop: 0 }),
            Matter.Bodies.rectangle(-20, 200, 40, 480, { isStatic: true, slop: 0 }),
            Matter.Bodies.rectangle(420, 200, 40, 480, { isStatic: true, slop: 0 }),
        ];
        Matter.Composite.add(engine.world, [body, ...walls]);
        Matter.Body.setVelocity(
            body,
            pixelsPerSecondVectorToMatterVelocity({ x: 1200, y: 1200 }, 1200),
        );

        step(engine, MATTER_FIXED_HZ * 2);

        expect(body.bounds.min.x).toBeGreaterThanOrEqual(-0.001);
        expect(body.bounds.max.x).toBeLessThanOrEqual(400.001);
        expect(body.bounds.min.y).toBeGreaterThanOrEqual(-0.001);
        expect(body.bounds.max.y).toBeLessThanOrEqual(400.001);
    });

    it("keeps constraint detach momentum finite", () => {
        const engine = createEngine(createMatterGravity({ x: 0, y: 200 }));
        const body = Matter.Bodies.rectangle(260, 120, 30, 30, { frictionAir: 0 });
        const constraint = Matter.Constraint.create({
            pointA: { x: 200, y: 40 },
            bodyB: body,
            length: 100,
            stiffness: 0.9,
            damping: 0.02,
        });
        Matter.Composite.add(engine.world, [body, constraint]);
        Matter.Body.setVelocity(body, { x: 4, y: 0 });
        step(engine, 45);
        Matter.Composite.remove(engine.world, constraint);
        step(engine, 1);

        expect(Number.isFinite(body.position.x)).toBe(true);
        expect(Number.isFinite(body.position.y)).toBe(true);
        expect(Number.isFinite(body.velocity.x)).toBe(true);
        expect(Number.isFinite(body.velocity.y)).toBe(true);
    });

    it("removes a static surface without leaving an active pair", () => {
        const engine = createEngine(createMatterGravity({ x: 0, y: 200 }));
        const body = Matter.Bodies.rectangle(100, 50, 30, 30, { frictionAir: 0 });
        const platform = Matter.Bodies.rectangle(100, 100, 160, 20, { isStatic: true });
        Matter.Composite.add(engine.world, [body, platform]);
        step(engine, 45);
        Matter.Composite.remove(engine.world, platform);
        step(engine, 2);

        const activePairs = engine.pairs.list
            .filter((pair) => pair.isActive)
            .filter((pair) => pair.bodyA.id === platform.id || pair.bodyB.id === platform.id);
        expect(activePairs).toEqual([]);
        expect(Number.isFinite(body.position.x)).toBe(true);
        expect(Number.isFinite(body.position.y)).toBe(true);
    });
});
