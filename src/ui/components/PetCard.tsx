import { Box, Button, Group, NativeSelect, Title } from "@mantine/core";
import { memo, useEffect, useState } from "react";
import { IPetCardProps, PetCardType } from "../../types/components/type";
import PhaserCanvas from "./PhaserCanvas";
import { useInView } from "react-intersection-observer";
import { ButtonVariant, CanvasSize, PrimaryColor } from "../../utils";
import classes from './PetCard.module.css';
import { usePetStateStore } from "../../hooks/usePetStateStore";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { SpriteType } from "../../types/ISpriteConfig";

function PetCard({ btnLabel, btnLabelCustom, pet, btnFunction, btnFunctionCustom, type }: IPetCardProps) {
    const { petStates, storeDictPetStates } = usePetStateStore();
    const availableStates = petStates[pet.name] ?? Object.keys(pet.states).map(state => (state));
    const randomState = availableStates[Math.floor(Math.random() * availableStates.length)];
    const [playState, setPlayState] = useState<string>(randomState);
    const { ref, inView } = useInView();
    const isCustomPet = (type === PetCardType.Add &&  pet.type === SpriteType.CUSTOM);

    // Cache state names because rebuilding every card's list is costly across the pet shop.
    useEffect(() => {
        if (!petStates.hasOwnProperty(pet.name)) {
            storeDictPetStates(pet.name, availableStates);
        }
    }, []);

    return (
        <>
            {/* Mount Phaser only for visible cards because every preview creates its own game instance. */}
            <Box id={`petCard-id-${pet.id ?? pet.customId}`} ref={ref} className={classes.boxWrapper} key={pet.id ?? pet.name}>
                {inView ?
                    <Box>
                        <PhaserCanvas pet={pet} playState={playState} key={pet.id} />
                        <Box p={"lg"}>
                            <Title order={4} className={classes.title}>{pet.name}</Title>
                            {/* NativeSelect avoids Mantine Select lag when dozens of pet cards are mounted. */}
                            <NativeSelect
                                my={"md"}
                                defaultValue={playState}
                                onChange={(event) => setPlayState(event.currentTarget.value)}
                                key={pet.id ?? pet.name}
                                data={availableStates}
                            />
                            <Group>
                                <Button
                                    variant={ButtonVariant}
                                    fullWidth
                                    onClick={btnFunction}
                                    color={type === PetCardType.Remove ? "red" : PrimaryColor}
                                    leftSection={type === PetCardType.Add ?
                                        <IconPlus /> :
                                        <IconTrash />
                                    }
                                >
                                    {btnLabel}
                                </Button>
                                {
                                    isCustomPet &&
                                    <Button
                                        variant={ButtonVariant}
                                        fullWidth
                                        onClick={btnFunctionCustom}
                                        color={"red"}
                                        leftSection={<IconTrash />}
                                    >
                                        {btnLabelCustom}
                                    </Button>
                                }
                            </Group>
                        </Box>
                    </Box>
                    :
                    <Box style={{
                        height: CanvasSize,
                        width: CanvasSize,
                    }}>
                    </Box>
                }
            </Box >
        </>
    )
};

export default memo(PetCard);
