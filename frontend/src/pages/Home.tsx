import React from "react";
import GroupsListContainer from "../components/groups/GroupsListContainer.tsx";

const Home: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-100">
      <GroupsListContainer />
    </div>
  );
};

export default Home;
