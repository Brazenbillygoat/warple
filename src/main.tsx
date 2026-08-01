import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { bootstrapOverlay } from "./startup";

document.addEventListener("contextmenu", (event) => event.preventDefault());

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Application root element is missing");
const root = ReactDOM.createRoot(rootElement);

bootstrapOverlay({
    search: window.location.search,
    mount: ({ profile, geometry, signalReady, signalAbort }) => {
        root.render(
            <App
                profile={profile}
                geometry={geometry}
                onReady={signalReady}
                onAbort={signalAbort}
            />,
        );
    },
});
