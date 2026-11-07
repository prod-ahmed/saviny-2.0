import { createBrowserRouter } from "react-router";
import BrixyApp from "../App";

export const router = createBrowserRouter([
  { path: "*", Component: BrixyApp },
]);
