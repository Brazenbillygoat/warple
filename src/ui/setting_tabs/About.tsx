import { memo, useEffect, useMemo, useState } from "react";
import { Anchor, Avatar, Flex, Text } from "@mantine/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from '@tauri-apps/api/app';
import { useTranslation } from "react-i18next";

function About() {
    const { t } = useTranslation();
    const [appVersion, setAppVersion] = useState('.....');

    useEffect(() => {
        getVersion().then((version) => {
            setAppVersion(version);
        });

        return () => {
            setAppVersion('.....');
        }
    }, []);

    const titleAndLinks = useMemo(() => ([
        {
            title: t("Source code:"),
            link: {
                url: "https://github.com/Brazenbillygoat/warple",
                label: "Brazenbillygoat/warple",
            },
        },
        {
            title: t("Upstream project:"),
            link: {
                url: "https://github.com/SeakMengs/WindowPet",
                label: "SeakMengs/WindowPet",
            },
        },
    ]), [t]);

    return (
        <Flex align={"center"} justify={"center"} direction={"column"} gap={"md"}>
            <Avatar
                src="/media/icon.png"
                alt="Warple"
                w={128}
                h={128}
            />
            <Text fw={700}>Warple</Text>
            <Text>{t("Version", { version: appVersion })}</Text>
            <Text color="dimmed">Updates are disabled for this development baseline.</Text>
            {
                titleAndLinks.map((item, index) => (
                    <Text key={`titleAndLinks-${index}`} display={"flex"}>
                        {item.title}
                        <Anchor mx={"xs"} onClick={() => openUrl(item.link.url)}>{item.link.label}</Anchor>
                    </Text>
                ))
            }
        </Flex>
    )
}

export default memo(About);
