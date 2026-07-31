import { Box } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import { ESettingTab } from "../../../types/ISetting";
import { useSettingStore } from "../../../hooks/useSettingStore";
import classes from "./AddCard.module.css";

function AddCard() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { theme: colorScheme } = useSettingStore();

    // The enum value keeps this shortcut aligned with SettingWindow's tab definitions.
    return (
        <Box onClick={() => {
            searchParams.set('tab', ESettingTab.PetShop.toString());
            setSearchParams(searchParams);
        }}
            className={classes.box}
            style={(theme) => ({
                backgroundColor: colorScheme === 'dark' ? theme.colors.dark[6] : theme.white,
                maxWidth: '14rem',
                borderRadius: theme.radius.md,
                boxShadow: theme.shadows.md,
                border: `0.0625rem solid ${colorScheme === 'dark' ? theme.colors.dark[4] : theme.colors.gray[3]}`,
                padding: theme.spacing.lg,
                width: '224px',
                height: '400px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
            })}>
            <IconPlus size={128} className={classes.plus} />
        </Box>
    )
}

export default AddCard;
