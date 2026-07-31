import { useMemo } from "react";
import { useLocation } from "react-router-dom";

// Keep query-string access behind one hook so tab navigation shares the same URL snapshot.
function useQueryParams() {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
}

export default useQueryParams;
