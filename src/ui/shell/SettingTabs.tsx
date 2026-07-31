import SettingTab from './SettingTab';
import { memo, useCallback } from 'react';
import { ISettingTabsProps } from '../../types/components/type';
import { useSettingTabStore } from '../../hooks/useSettingTabStore';
import { useSearchParams } from 'react-router';

function SettingTabs({ activeTab, settingTabs }: ISettingTabsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { setActiveTab } = useSettingTabStore();

  const handleSetTab = useCallback((index: number) => {
    setActiveTab(index);

    // Mirror the active tab in the URL so refreshes preserve navigation.
    searchParams.set('tab', index.toString());
    setSearchParams(searchParams);
  }, [setActiveTab]);

  const sections = settingTabs.map((settingTab) => <SettingTab label={settingTab.label} Icon={settingTab.Icon} key={settingTab.label} active={settingTab.tab === activeTab} handleSetTab={() => handleSetTab(settingTab.tab)} />);

  return <>{sections}</>;
}

export default memo(SettingTabs);
