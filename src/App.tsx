import PhaserWrapper from "./PhaserWrapper";
import type { ValidatedCompanionProfile } from "./profiles/types";
import type { OverlayGeometry } from "./runtime/geometry";

interface AppProps {
    readonly profile: ValidatedCompanionProfile;
    readonly geometry: OverlayGeometry;
    readonly onReady: () => void;
    readonly onAbort: () => void;
}

function App(props: AppProps) {
    return <PhaserWrapper {...props} />;
}

export default App;
