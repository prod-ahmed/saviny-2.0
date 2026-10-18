import { createBrowserRouter } from "react-router";
import SavinyApp from "../App";

export const router = createBrowserRouter([
  { path: "*", Component: SavinyApp },
]);
